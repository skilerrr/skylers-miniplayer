Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null

function AwaitTask($asyncOp, $type) {
    if (-not $asyncOp) { return $null }
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
        Select-Object -First 1
    if (-not $asTask) { return $null }
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($asyncOp))
    $task.Wait(1200) | Out-Null
    return $task.Result
}

$mgrOp = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$mgr = AwaitTask $mgrOp ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])

$session = $mgr.GetCurrentSession()
if ($session) {
    $info = $session.GetPlaybackInfo()
    Write-Output ("SourceApp: " + $session.SourceAppUserModelId)
    Write-Output ("Controls: " + ($info.Controls | ConvertTo-Json -Compress))
    
    $timeline = $session.GetTimelineProperties()
    Write-Output ("Current Pos: " + $timeline.Position.TotalSeconds)
    
    $targetSec = 45.0
    $ticks = [long]($targetSec * 10000000)
    Write-Output ("Seeking to $targetSec sec ($ticks ticks)...")
    
    $seekOp = $session.TryChangePlaybackPositionAsync($ticks)
    $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() | 
        Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | 
        Select-Object -First 1
    $task = $asTaskMethod.MakeGenericMethod([System.Boolean]).Invoke($null, @($seekOp))
    $task.Wait(1200) | Out-Null
    Write-Output ("Seek Result: " + $task.Result)
} else {
    Write-Output "No active session found"
}
