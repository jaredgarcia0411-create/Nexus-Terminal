# Nexus Terminal - Vercel Deployment Guide

This application is ready to be deployed to Vercel. Follow these steps to get your custom URL and live application.

## 1. Push to GitHub
1. Create a new repository on GitHub.
2. Push your code to the repository.

## 2. Deploy to Vercel
1. Go to [Vercel](https://vercel.com) and click **"Add New"** > **"Project"**.
2. Import your GitHub repository.
3. In the **Environment Variables** section, add the following:

| Variable | Description |
|----------|-------------|
| `GOOGLE_CLIENT_ID` | Your Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Your Google OAuth Client Secret |
| `SCHWAB_CLIENT_ID` | Your Schwab API Client ID |
| `SCHWAB_CLIENT_SECRET` | Your Schwab API Client Secret |
| `JWT_SECRET` | A long random string for session security |
| `NEXT_PUBLIC_GEMINI_API_KEY` | Your Gemini API Key |

*Note: `APP_URL` is optional on Vercel as the app will automatically detect its URL.*

## 3. Configure OAuth Redirect URIs
Once Vercel gives you a URL (e.g., `https://nexus-terminal.vercel.app`), you must update your OAuth providers:

### Google Console
- **Authorized Redirect URI**: `https://your-app.vercel.app/api/auth/google/callback`

### Schwab Developer Portal
- **Authorized Redirect URI**: `https://your-app.vercel.app/api/auth/schwab/callback`

## 4. Custom Domain
1. In Vercel, go to **Settings** > **Domains**.
2. Enter your purchased domain (e.g., `www.yourtradingjournal.com`).
3. Follow the DNS instructions provided by Vercel to connect your domain registrar.
