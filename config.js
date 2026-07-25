module.exports = {
  // Categorías padre completas — se traen TODOS los proyectos taggeados
  // con cualquiera de estos IDs, sin necesidad de listar cada skill.
  JOB_CATEGORIES: [
    1,   // Websites, IT & Software
    9,   // Mobile Phones & Computing
    104, // Artificial Intelligence
  ],

  // Skills puntuales de diseño/web que viven dentro de categorías mixtas
  // (Design, Media & Architecture), sin traer arquitectura de edificios,
  // diseño gráfico genérico, etc.
  JOBS: [
    17,   // Website Design
    482,  // Landing Pages
    710,  // UX / User Experience
    959,  // UI / User Interface
    2245, // WordPress Design
    371,  // Shopify Templates
    2247, // Web Animation
  ],

  LANGUAGES: ['es', 'en'],

  // Filtro local extra: si el título o la descripción de preview contiene
  // alguna de estas palabras, el proyecto se descarta aunque haya
  // matcheado por categoría/skill en la API. Sirve para cortar ruido tipo
  // "sales partner", "telemarketing", etc. que igual se cuela por tags
  // cruzados en la plataforma.
  BLOCKLIST_KEYWORDS: [
    'commission-based',
    'commission only',
    'telemarketing',
    'cold caller',
    'cold calling',
    'recruiter',
    'sales partner',
    'sales representative',
    'appointment setter',
    'door to door',
    'multi level marketing',
    'mlm',
  ],
};
