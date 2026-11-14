// Local development server only. On Vercel the app runs through api/index.js.
import app from './app.js';

const port = Number(process.env.API_PORT) || 3001;
app.listen(port, () => console.log(`OnioNet API listening on http://localhost:${port}`));
