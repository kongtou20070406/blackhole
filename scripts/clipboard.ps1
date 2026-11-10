param([Parameter(Mandatory = $true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
    throw 'The Windows clipboard has no image. Take a screenshot or copy an image first.'
}
try {
    $image.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally {
    $image.Dispose()
}
