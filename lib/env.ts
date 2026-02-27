export function getBaseUrl() {
  if (process.env.APP_URL) {
    return process.env.APP_URL;
  }
  
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }
  
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  
  return 'http://localhost:3000';
}
