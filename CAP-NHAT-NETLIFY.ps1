$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
Write-Host 'Cap nhat landing MYB va thanh toan payOS len stalwart-dragon-988b54' -ForegroundColor Cyan
try {
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
    Write-Host 'Can cai Node.js LTS truoc: https://nodejs.org/en/download' -ForegroundColor Yellow
    throw 'Chua cai Node.js. Cai xong, mo lai file CAP-NHAT-NETLIFY.cmd.'
  }
  & npm.cmd ci --ignore-scripts --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Khong cai duoc thu vien.' }
  & npx.cmd --yes netlify-cli login
  if ($LASTEXITCODE -ne 0) { throw 'Chua dang nhap Netlify.' }
  & npx.cmd --yes netlify-cli link --name stalwart-dragon-988b54
  if ($LASTEXITCODE -ne 0) { throw 'Khong tim thay project stalwart-dragon-988b54 trong tai khoan Netlify.' }
  & npx.cmd --yes netlify-cli deploy --prod --dir=public --functions=netlify/functions
  if ($LASTEXITCODE -ne 0) { throw 'Deploy chua thanh cong. Giu cua so nay de xem loi.' }
  Write-Host 'DA CAP NHAT. Mo https://stalwart-dragon-988b54.netlify.app/ de kiem tra.' -ForegroundColor Green
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
}
Read-Host 'Nhan Enter de dong'
