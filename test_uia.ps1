Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$proc = Get-Process -Name "AppleMusic" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) {
    Write-Output "AppleMusic PID: $($proc.Id)"
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $proc.Id)
    $elements = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
    Write-Output "Elements in AppleMusic: $($elements.Count)"
    foreach ($el in $elements) {
        if ($el.Current.ControlType.ProgrammaticName -match 'Slider|Button|Thumb') {
            Write-Output "Element: $($el.Current.ControlType.ProgrammaticName) Name='$($el.Current.Name)' ID='$($el.Current.AutomationId)'"
        }
    }
}
