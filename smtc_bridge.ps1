# SMTC Bridge for Apple Music Aesthetic Miniplayer - Ultra-Low Latency Engine
Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null

$OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$coverFilePath = Join-Path $scriptDir "cover_temp.jpg"

function AwaitTask($asyncOp, $type) {
    if (-not $asyncOp) { return $null }
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
        Select-Object -First 1
    if (-not $asTask) { return $null }
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($asyncOp))
    $task.Wait(1000) | Out-Null
    return $task.Result
}

function AwaitActionTask($asyncOp) {
    if (-not $asyncOp) { return $null }
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
        Select-Object -First 1
    if (-not $asTask) { return $null }
    $task = $asTask.MakeGenericMethod([System.Boolean]).Invoke($null, @($asyncOp))
    $task.Wait(1000) | Out-Null
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

$managerOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$manager = AwaitTask $managerOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

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
                        $null = AwaitActionTask ($session.TryPlayAsync())
                    }
                    "PAUSE" {
                        $null = AwaitActionTask ($session.TryPauseAsync())
                    }
                    "TOGGLE" {
                        $null = AwaitActionTask ($session.TryTogglePlayPauseAsync())
                    }
                    "NEXT" {
                        $null = AwaitActionTask ($session.TrySkipNextAsync())
                    }
                    "PREV" {
                        $null = AwaitActionTask ($session.TrySkipPreviousAsync())
                    }
                    "SEEK" {
                        if ($cmdParts.Length -gt 1) {
                            try {
                                $sec = [double]::Parse($cmdParts[1], [System.Globalization.CultureInfo]::InvariantCulture)
                                $ticks = [long]($sec * 10000000)
                                $null = AwaitActionTask ($session.TryChangePlaybackPositionAsync($ticks))
                            } catch {}
                        }
                    }
                }
            }
        }
    }

    # 2. Query SMTC Media State (Low latency)
    try {
        $session = GetActiveMediaSession $manager

        if ($session) {
            $mediaPropOp = $session.TryGetMediaPropertiesAsync()
            $props = AwaitTask $mediaPropOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
            
            $playbackInfo = $session.GetPlaybackInfo()
            $timeline = $session.GetTimelineProperties()

            $rawTitle = if ($props -and $props.Title) { $props.Title } else { "" }
            $rawArtist = if ($props -and $props.Artist) { $props.Artist } else { "" }
            $rawAlbum = if ($props -and $props.AlbumTitle) { $props.AlbumTitle } else { "" }
            
            # Extract clean Artist and Album
            $title = $rawTitle
            $artist = $rawArtist
            $album = $rawAlbum

            if ($rawArtist -match '^(.*?)\s*[\u2014\u2013-]\s*(.*)$' -and -not $album) {
                $artist = $Matches[1].Trim()
                $album = $Matches[2].Trim()
            }

            $status = if ($playbackInfo) { $playbackInfo.PlaybackStatus.ToString() } else { "Closed" }
            $pos = if ($timeline) { [Math]::Round($timeline.Position.TotalSeconds, 2) } else { 0 }
            $dur = if ($timeline) { [Math]::Round($timeline.EndTime.TotalSeconds, 2) } else { 0 }
            
            $trackKey = "$title|$artist|$album|$dur"
            $coverUpdated = $false
            $coverUrl = $lastCoverPath

            # If track changed, extract thumbnail to file
            if ($trackKey -ne $lastTrackKey -or (-not $lastCoverPath -and $title)) {
                $coverUrl = ""
                if ($props -and $props.Thumbnail) {
                    try {
                        $streamOp = $props.Thumbnail.OpenReadAsync()
                        $stream = AwaitTask $streamOp ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
                        if ($stream) {
                            $asStreamMethod = [System.IO.WindowsRuntimeStreamExtensions].GetMethods() | 
                                Where-Object { $_.Name -eq 'AsStreamForRead' } | Select-Object -First 1
                            $netStream = $asStreamMethod.Invoke($null, @($stream))
                            $ms = New-Object System.IO.MemoryStream
                            $netStream.CopyTo($ms)
                            $bytes = $ms.ToArray()
                            if ($bytes.Length -gt 0) {
                                [System.IO.File]::WriteAllBytes($coverFilePath, $bytes)
                                $coverUrl = "file:///" + ($coverFilePath -replace '\\', '/') + "?v=" + [DateTime]::UtcNow.Ticks
                            }
                        }
                    } catch {}
                }
                $lastCoverPath = $coverUrl
                $lastTrackKey = $trackKey
                $coverUpdated = $true
            }

            # Emit lightweight state update JSON
            $outObj = @{
                type = "media_update"
                title = $title
                artist = $artist
                album = $album
                status = $status
                position = $pos
                duration = $dur
                cover = $coverUrl
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

    Start-Sleep -Milliseconds 120
}
