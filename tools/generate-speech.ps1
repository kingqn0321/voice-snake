$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$directory = Join-Path $PSScriptRoot '../test-results/speech'
$directory = [System.IO.Path]::GetFullPath($directory)
New-Item -ItemType Directory -Force -Path $directory | Out-Null
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $synth.SelectVoice('Microsoft Huihui Desktop')
    # Code points also work in Windows PowerShell 5.1 without a UTF-8 BOM.
    $samples = @(
        ([string][char]0x4E0A), ([string][char]0x4E0B),
        ([string][char]0x5DE6), ([string][char]0x53F3)
    )
    foreach ($direction in $samples[0..3]) { $samples += ([string][char]0x5411) + $direction }
    $samples += @(
        -join ([char[]](0x6682, 0x505C)), -join ([char[]](0x7EE7, 0x7EED)),
        -join ([char[]](0x518D, 0x6765, 0x4E00, 0x5C40)),
        -join ([char[]](0x7ED3, 0x675F, 0x6E38, 0x620F)),
        -join ([char[]](0x4E0D, 0x8981, 0x5411, 0x5DE6))
    )
    for ($i = 0; $i -lt $samples.Count; $i++) {
        $synth.SetOutputToWaveFile((Join-Path $directory "$i.wav"))
        $synth.Speak($samples[$i])
        $synth.SetOutputToNull()
    }
} finally { $synth.Dispose() }
Write-Output "Synthetic fixtures: $directory"
