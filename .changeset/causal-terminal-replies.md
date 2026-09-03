---
'@termwright/driver': patch
---

Serialize pending emulator replies ahead of later user input. This prevents application-owned terminal responses from racing keyboard and mouse actions, including through the ConPTY input transport.
