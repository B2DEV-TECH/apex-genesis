$ErrorActionPreference = 'Stop'
$projectPath = Split-Path -Parent $PSScriptRoot
$narration = Get-Content -LiteralPath (Join-Path $projectPath 'media/narration.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$outputPath = Join-Path $projectPath '.local/video/audio'
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$voice = New-Object -ComObject SAPI.SpVoice
$englishVoices = @($voice.GetVoices() | Where-Object { $_.GetDescription() -like '*Zira*' })
if ($englishVoices.Count -ne 1) { throw 'An installed Microsoft Zira English voice is required. No paid voice service is used.' }
$voice.Voice = $englishVoices[0]
$voice.Rate = 0
$number = 0
foreach ($chapter in $narration.chapters) {
  foreach ($caption in $chapter.captions) {
    $number++
    $stream = New-Object -ComObject SAPI.SpFileStream
    try {
      $stream.Open((Join-Path $outputPath ('{0:d2}.wav' -f $number)),3,$false)
      $voice.AudioOutputStream = $stream
      $voice.Speak([string]$caption) | Out-Null
    } finally { $stream.Close() }
  }
}
Write-Output ('Generated '+$number+' local English narration segments.')
