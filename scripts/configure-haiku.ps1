$ErrorActionPreference = 'Stop'
$secureKey = Read-Host 'Anthropic API key (stored only in an APEX Web Credential)' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
try {
  $keyText = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  $keyText | node (Join-Path $PSScriptRoot 'configure-haiku.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'Credential configuration failed' }
} finally {
  $keyText = $null
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  $secureKey.Dispose()
}
