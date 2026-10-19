# SMTC Bridge for Skyler's Miniplayer - ultra-low latency, low-overhead Windows media bridge
Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# System.Drawing is used to downscale the SMTC thumbnail before it crosses stdout
Add-Type -AssemblyName System.Drawing

# Cache AsTask Reflection Methods once at startup (prevents heavy reflection in loops)
$extType = [System.WindowsRuntimeSystemExtensions]
$genericAsTask = $extType.GetMethods() | 
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
    Select-Object -First 1

$asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | 
    Where-Object { $_.Name -eq 'AsStreamForRead' } | Select-Object -First 1

# Method cache for generic types
$asTaskCache = @{}

function AwaitTaskFast($asyncOp, [Type]$type) {
    if (-not $asyncOp) { return $null }
    $typeName = $type.FullName
    $method = $asTaskCache[$typeName]
    if (-not $method) {
        $method = $genericAsTask.MakeGenericMethod($type)
        $asTaskCache[$typeName] = $method
    }
    $task = $method.Invoke($null, @($asyncOp))
    $task.Wait(1200) | Out-Null
    return $task.Result
}

# Start non-blocking Stdin Reader for instant command execution
$cmdQueue = [System.Collections.Queue]::Synchronized((New-Object System.Collections.Queue))
$rs = [RunspaceFactory]::CreateRunspace()
$rs.Open()
$psStdin = [PowerShell]::Create()
$psStdin.Runspace = $rs
$null = $psStdin.AddScript({
    param($q)
    try {
        while ($true) {
            $line = [Console]::ReadLine()
            if ($line -ne $null) {
                $q.Enqueue($line)
            } else {
                break
            }
        }
    } catch {}
}).AddArgument($cmdQueue).BeginInvoke()

$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$mediaPropType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType]
$boolType = [System.Boolean]

$managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$manager = AwaitTaskFast $managerOp $mgrType

if (-not $manager) {
    $errObj = @{ type = "error"; message = "Failed to initialize Windows SMTC Manager" }
    Write-Output (ConvertTo-Json $errObj -Compress)
    exit 1
}

function GetActiveMediaSession($mgr) {
    $s = $mgr.GetCurrentSession()
    if ($s) { return $s }
    $sessions = $mgr.GetSessions()
    if ($sessions -and $sessions.Count -gt 0) {
        foreach ($sess in $sessions) {
            if ($sess.SourceAppUserModelId -match 'AppleMusic') {
                return $sess
            }
        }
        return $sessions[0]
    }
    return $null
}

$lastTrackKey = ""
$lastCoverPath = ""

while ($true) {
    # 1. Process queued commands instantly
    while ($cmdQueue.Count -gt 0) {
        $cmdLine = $cmdQueue.Dequeue()
        if ($cmdLine) {
            $cmdParts = $cmdLine.Trim().Split(' ')
            $cmd = $cmdParts[0].ToUpper()
            $session = GetActiveMediaSession $manager
            if ($session) {
                switch ($cmd) {
                    "PLAY" {
                        $null = AwaitTaskFast ($session.TryPlayAsync()) $boolType
                    }
                    "PAUSE" {
                        $null = AwaitTaskFast ($session.TryPauseAsync()) $boolType
                    }
                    "TOGGLE" {
                        $null = AwaitTaskFast ($session.TryTogglePlayPauseAsync()) $boolType
                    }
                    "NEXT" {
                        $null = AwaitTaskFast ($session.TrySkipNextAsync()) $boolType
                    }
                    "PREV" {
                        $null = AwaitTaskFast ($session.TrySkipPreviousAsync()) $boolType
                    }
                    "SEEK" {
                        if ($cmdParts.Length -gt 1) {
                            try {
                                $sec = [double]::Parse($cmdParts[1], [System.Globalization.CultureInfo]::InvariantCulture)
                                $ticks = [long]($sec * 10000000)
                                $null = AwaitTaskFast ($session.TryChangePlaybackPositionAsync($ticks)) $boolType
                            } catch {}
                        }
                    }
                }
            }
        }
    }

    # 2. Query SMTC Media State with fast execution
    $currentStatus = "Stopped"
    try {
        $session = GetActiveMediaSession $manager

        if ($session) {
            $mediaPropOp = $session.TryGetMediaPropertiesAsync()
            $props = AwaitTaskFast $mediaPropOp $mediaPropType
            
            $playbackInfo = $session.GetPlaybackInfo()
            $timeline = $session.GetTimelineProperties()

            $rawTitle = if ($props -and $props.Title) { $props.Title } else { "" }
            $rawArtist = if ($props -and $props.Artist) { $props.Artist } else { "" }
            $rawAlbum = if ($props -and $props.AlbumTitle) { $props.AlbumTitle } else { "" }
            
            # Extract clean Artist and Album
            $title = $rawTitle
            $artist = $rawArtist
            $album = $rawAlbum

            if ($rawArtist -match '^(.*?)\s*[\u2014\u2013]\s*(.*)$' -or $rawArtist -match '^(.*?)\s+[-–—]\s+(.*)$') {
                $artist = $Matches[1].Trim()
                if (-not $album) {
                    $album = $Matches[2].Trim()
                }
            }

            $currentStatus = if ($playbackInfo) { $playbackInfo.PlaybackStatus.ToString() } else { "Closed" }
            
            $pos = 0
            $dur = 0
            if ($timeline) {
                $basePos = $timeline.Position.TotalSeconds
                if ($currentStatus -eq "Playing" -and $timeline.LastUpdatedTime) {
                    try {
                        $elapsedSinceUpdate = ([DateTimeOffset]::UtcNow - $timeline.LastUpdatedTime).TotalSeconds
                        if ($elapsedSinceUpdate -gt 0 -and $elapsedSinceUpdate -lt 15) {
                            $basePos += $elapsedSinceUpdate
                        }
                    } catch {}
                }
                $pos = [Math]::Round($basePos, 2)
                $dur = [Math]::Round($timeline.EndTime.TotalSeconds, 2)
            }
            
            $trackKey = "$title|$artist|$album|$dur"
            $coverUpdated = $false
            $coverUrl = ""

            # Extract the thumbnail ONCE per track change and downscale it to 100px JPEG
            # (raw SMTC art is ~190 KB base64 and used to be re-sent every 150 ms)
            if ($trackKey -ne $lastTrackKey -or (-not $lastCoverPath -and $title)) {
                if ($props -and $props.Thumbnail) {
                    try {
                        $streamOp = $props.Thumbnail.OpenReadAsync()
                        $stream = AwaitTaskFast $streamOp $streamType
                        if ($stream -and $asStreamMethod) {
                            $netStream = $asStreamMethod.Invoke($null, @($stream))
                            $ms = New-Object System.IO.MemoryStream
                            $netStream.CopyTo($ms)
                            $bytes = $ms.ToArray()
                            $ms.Dispose()
                            if ($bytes.Length -gt 0) {
                                $thumbBytes = $null
                                try {
                                    $srcStream = New-Object System.IO.MemoryStream(, $bytes)
                                    $srcBmp = [System.Drawing.Image]::FromStream($srcStream)
                                    $tw = 100
                                    $th = [int][Math]::Round($srcBmp.Height * $tw / $srcBmp.Width)
                                    if ($th -lt 1) { $th = $tw }
                                    $thumbBmp = New-Object System.Drawing.Bitmap($tw, $th, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
                                    $gfx = [System.Drawing.Graphics]::FromImage($thumbBmp)
                                    $gfx.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                                    $gfx.DrawImage($srcBmp, 0, 0, $tw, $th)
                                    $gfx.Dispose()
                                    $outMs = New-Object System.IO.MemoryStream
                                    $thumbBmp.Save($outMs, [System.Drawing.Imaging.ImageFormat]::Jpeg)
                                    $thumbBytes = $outMs.ToArray()
                                    $outMs.Dispose()
                                    $thumbBmp.Dispose()
                                    $srcBmp.Dispose()
                                    $srcStream.Dispose()
                                } catch { $thumbBytes = $null }
                                if (-not $thumbBytes -or $thumbBytes.Length -eq 0) { $thumbBytes = $bytes }
                                $b64 = [Convert]::ToBase64String($thumbBytes)
                                $coverUrl = "data:image/jpeg;base64,$b64"
                                $lastCoverPath = $coverUrl
                                $coverUpdated = $true
                            }
                        }
                    } catch {}
                }
                $lastTrackKey = $trackKey
            }

            # Emit state update JSON
            $outObj = @{
                type = "media_update"
                title = $title
                artist = $artist
                album = $album
                status = $currentStatus
                position = $pos
                duration = $dur
                cover = $(if ($coverUpdated) { $coverUrl } else { "" })
                trackChanged = $coverUpdated
            }

            Write-Output (ConvertTo-Json $outObj -Compress)
        } else {
            $outObj = @{
                type = "media_update"
                title = ""
                artist = ""
                album = ""
                status = "Stopped"
                position = 0
                duration = 0
                cover = ""
                trackChanged = $false
            }
            Write-Output (ConvertTo-Json $outObj -Compress)
        }
    } catch {}

    # Adaptive sleep: 150ms when playing for tight SMTC sync, 600ms when paused/stopped
    if ($currentStatus -eq "Playing") {
        Start-Sleep -Milliseconds 150
    } else {
        Start-Sleep -Milliseconds 600
    }
}
