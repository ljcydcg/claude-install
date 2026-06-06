Bundled winget offline assets

Source:
- https://aka.ms/getwinget
- https://github.com/microsoft/winget-cli/releases/tag/v1.28.240

Files:
- Microsoft.DesktopAppInstaller_8wekyb3d8bbwe.msixbundle
  - Size: 215978341 bytes
  - SHA256: 4EA2208F1648462BDC8C211811BBC8B2DB1174A4172FB53FDBC52459FE09367E
- DesktopAppInstaller_Dependencies.zip
  - Size: 97760717 bytes
  - SHA256: 71A4B86F5FD3D2012E1120FCE7937F26B7C7FEAB0E4302EBD9BE79AB0155FAA5

Runtime behavior:
- The app copies these files to a temporary directory before running Add-AppxPackage.
- The dependency zip is optional but bundled to make offline installation more reliable.
