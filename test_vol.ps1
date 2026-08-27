Add-Type -Path (Join-Path $PSScriptRoot "AppVolumeHelper.cs")
$vol = [AudioMixer.AppVolumeController]::GetVolume("AppleMusic")
Write-Output "Apple Music Application Volume: $vol"
