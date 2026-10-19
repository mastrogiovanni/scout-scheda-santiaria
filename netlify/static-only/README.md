This deployment is frontend-only. No Netlify Functions are deployed.
The previous functions and server/ are retained as historical sources and are not imported by the app or local server. Apply the new Supabase migration; existing legacy data are left intact. Legacy retention jobs must be handled separately before retiring an existing deployment.
