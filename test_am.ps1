Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Apple Music")
$amWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)

if (-not $amWin) {
    # Search all children for process ID of AppleMusic
    $p = Get-Process -Name "AppleMusic" -ErrorAction SilentlyContinue
    if ($p) {
        $pCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $p.Id)
        $amWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $pCond)
    }
}

if ($amWin) {
    Write-Output "Found Apple Music Window: $($amWin.Current.Name)"
    $all = $amWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    Write-Output "Total elements: $($all.Count)"
    foreach ($el in $all) {
        $name = $el.Current.Name
        $id = $el.Current.AutomationId
        $type = $el.Current.ControlType.ProgrammaticName
        if ($type -like "*Slider*" -or $name -like "*Volume*" -or $id -like "*volume*" -or $name -like "*Lossless*" -or $name -like "*Dolby*" -or $name -like "*bit*" -or $name -like "*kHz*") {
            Write-Output "MATCH: Type=$type Name='$name' ID='$id'"
            $valPattern = $el.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
            if ($valPattern) {
                Write-Output "  -> Value=$($valPattern.Current.Value) Min=$($valPattern.Current.Minimum) Max=$($valPattern.Current.Maximum)"
            }
        }
    }
} else {
    Write-Output "Apple Music Window not found directly via root children"
}
