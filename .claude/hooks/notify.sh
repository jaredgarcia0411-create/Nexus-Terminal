#!/bin/bash
# Sends a Windows toast notification via PowerShell when Claude needs input.
# Works on WSL2 where notify-send isn't available.
powershell.exe -Command "
  [void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
  \$n = New-Object System.Windows.Forms.NotifyIcon
  \$n.Icon = [System.Drawing.SystemIcons]::Information
  \$n.BalloonTipTitle = 'Claude Code'
  \$n.BalloonTipText = 'Waiting for your input'
  \$n.Visible = \$true
  \$n.ShowBalloonTip(5000)
  Start-Sleep -Seconds 6
  \$n.Dispose()
" > /dev/null 2>&1
exit 0
