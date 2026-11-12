// Configuración central de Kodia Studio. Todo lo ajustable vive aquí.
module.exports = {
  openai: {
    endpoint: 'https://api.openai.com/v1/images/edits',
    model: process.env.STUDIO_MODEL || 'gpt-image-2',
    quality: process.env.STUDIO_QUALITY || 'medium',
    size: process.env.STUDIO_SIZE || '1024x1024',
    outputFormat: 'jpeg',
    timeoutMs: 50000, // la función tiene maxDuration 60 s (vercel.json)
  },
  imgbb: {
    endpoint: 'https://api.imgbb.com/1/upload',
    // Misma clave que ya usa /admin. Si defines IMGBB_API_KEY en Vercel, tiene prioridad.
    key: process.env.IMGBB_API_KEY || 'B922654effe3a1ab5ac85cc4c23f97b8',
  },
  firebase: {
    // Clave web pública (la misma de admin/index.html); sirve para verificar el token del admin.
    webApiKey: 'AIzaSyDZxtwqBOpiJjMrRlF5tgfVl7uEPpACfoE',
    logCollection: 'studioGenerations',
  },
  limits: {
    maxImageBytes: 3.5 * 1024 * 1024, // la foto ya llega reducida desde el navegador
  },
  // Precios opcionales (USD por 1M de tokens). Sin ellos NO se calcula costo: no se inventa nada.
  pricing: {
    inputPerM: process.env.STUDIO_PRICE_INPUT_PER_M ? Number(process.env.STUDIO_PRICE_INPUT_PER_M) : null,
    outputPerM: process.env.STUDIO_PRICE_OUTPUT_PER_M ? Number(process.env.STUDIO_PRICE_OUTPUT_PER_M) : null,
  },
};
