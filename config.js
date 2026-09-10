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

    // --- Skills del perfil ---
    // Las categorías padre no alcanzan: Freelancer clasifica muchos proyectos
    // fuera de ellas y se perdían trabajos claramente propios, como scraping
    // con MySQL o automatizaciones con API.
    9,    // JavaScript
    95,   // Web Scraping
    305,  // MySQL
    500,  // Node.js
    607,  // PostgreSQL
    613,  // Software Development
    759,  // React.js
    979,  // Typescript
    1031, // Web Development
    1977, // Automation
    2164, // API Development
    2986, // AI Development
    3,    // PHP
    69,   // WordPress
    137,  // eCommerce
    502,  // Shopify
    2701, // Web Design
    216,  // Technical Support  (vive en Data Entry & Admin)
    521,  // Spanish Translator (vive en Translation & Languages)

    // --- Adyacentes, agregadas para ampliar la vista ---
    // Mismo trabajo con otro nombre, o herramientas que ya usás.
    13,   // Python            (scraping y automatización)
    116,  // Software Architecture
    1088, // Full Stack Development
    1092, // Backend Development
    1093, // Frontend Development
    3098, // Frontend Frameworks
    598,  // Express JS
    1254, // MongoDB
    1002, // Docker
    1678, // DevOps             (vive en Engineering & Science)
    1019, // Scripting
    1075, // Data Scraping      (vive en Data Entry & Admin)
    1077, // Data Extraction    (vive en Data Entry & Admin)
    2068, // Chatbot
    2380, // Telegram API
    913,  // Artificial Intelligence
    2791, // ChatGPT
    2966, // Large Language Models (LLMs)
    2946, // LLM Prompt Engineering
    3112, // n8n
    2050, // Zapier
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

    // Ruido que aparecio al ampliar las skills: listas de contactos, locucion,
    // tareas de carga de datos y trabajos de venta con otro nombre.
    'sales closer',
    'closer needed',
    'verified leads',
    'lead list',
    'lead generation',
    'voice-over',
    'voice over',
    'data entry',
    'copy paste',
    'virtual assistant',
    'essay',
    'academic writing',
  ],
};
