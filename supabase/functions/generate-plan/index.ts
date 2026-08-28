const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CLAUDE_MODEL = "claude-sonnet-5";
const CLAUDE_MAX_TOKENS = 8000;
const NIVELES_BLOOM = ["Recordar", "Comprender", "Aplicar", "Analizar"] as const;
const MIN_SESIONES = 3;
const MAX_SESIONES = 5;
const MAX_MINUTOS_SESION = 30;

interface ArchivoSubido {
  nombre: string;
  tipo: string;
  url: string;
}

interface TextoExtraido {
  nombre: string;
  texto: string;
}

interface ImagenReferencia {
  nombre: string;
  url: string;
}

interface SolicitudPlan {
  semana: number;
  titulo: string;
  asignatura?: string;
  notas?: string;
  video?: string | null;
  archivos?: ArchivoSubido[];
  textosExtraidos?: TextoExtraido[];
  imagenes?: ImagenReferencia[];
}

interface Ejercicio {
  enunciado_texto: string;      // "Resuelve la ecuación"
  enunciado_latex: string;       // "3x^2 + 2x - 1 = 0"
  pasos: string[];              // pasos en texto plano
  pasos_latex?: string[];        // pasos con LaTeX (opcional)
}

interface SesionPlan {
  numero: number;
  titulo: string;
  tiempo_minutos: number;
  nivel_bloom: (typeof NIVELES_BLOOM)[number];
  objetivos: string[];
  actividades: string[];
  evaluacion: string;
  ejercicios: Ejercicio[];
  ejercicios_practica?: {
    enunciado_texto: string;
    enunciado_latex?: string;
  }[];
}

interface PlanEstudio {
  semana: number;
  tema_principal: string;
  sesiones: SesionPlan[];
}

// El formato esperado se describe explícitamente en el prompt para que el
// modelo responda con JSON en la forma correcta.
const EJEMPLO_FORMATO_PLAN = {
  semana: 1,
  tema_principal: "string",
  sesiones: [
    {
      numero: 1,
      titulo: "string",
      tiempo_minutos: 30,
      nivel_bloom: NIVELES_BLOOM.join(" | "),
      objetivos: ["string"],
      actividades: ["string"],
      evaluacion: "string",
      ejercicios: [
        {
          enunciado_texto: "string",
          enunciado_latex: "string",
          pasos: ["string"],
          pasos_latex: ["string"],
        },
      ],
      ejercicios_practica: [
        {
          enunciado_texto: "Ejercicio para practicar sin solución",
          enunciado_latex: "[solo si aplica para esta asignatura]",
        },
      ],
    },
  ],
};

function construirContenidoClase(body: SolicitudPlan): string {
  const partes: string[] = [];

  if (body.notas?.trim()) {
    partes.push(`### Notas / apuntes de la clase\n${body.notas.trim()}`);
  }

  if (body.textosExtraidos?.length) {
    for (const t of body.textosExtraidos) {
      partes.push(`### Contenido extraído de "${t.nombre}"\n${t.texto}`);
    }
  }

  if (body.archivos?.length) {
    const listaArchivos = body.archivos
      .map((a) => `- ${a.nombre} (${a.tipo}): ${a.url}`)
      .join("\n");
    partes.push(`### Archivos adjuntos disponibles\n${listaArchivos}`);
  }

  if (body.imagenes?.length) {
    const listaImagenes = body.imagenes
      .map((i) => `- ${i.nombre}: ${i.url}`)
      .join("\n");
    partes.push(`### Imágenes de referencia\n${listaImagenes}`);
  }

  if (body.video?.trim()) {
    partes.push(`### Video de apoyo\n${body.video.trim()}`);
  }

  return partes.join("\n\n") || "(No se proporcionó contenido adicional)";
}

function construirPromptMatematicas(): string {
  return `
EJERCICIOS (Matemáticas):
- Si el contenido tiene ecuaciones/fórmulas: enunciado_texto, enunciado_latex, pasos[], pasos_latex[] con 2-3 pasos numéricos claros
- Si el contenido es conceptual: enunciado_texto, pasos: [] (pregunta de análisis, sin pasos)
- Decide según el CONTENIDO SUBIDO, no la asignatura
  `;
}

function construirPromptQuimica(): string {
  return `
EJERCICIOS (Química):
- Si el contenido tiene ecuaciones/fórmulas: enunciado_texto, enunciado_latex (notación mhchem), pasos[], pasos_latex[] con 2-3 pasos claros
- Si el contenido es conceptual: enunciado_texto, pasos: [] (pregunta de análisis, sin pasos)
- Decide según el CONTENIDO SUBIDO, no la asignatura
  `;
}

function construirPromptFisica(): string {
  return `
EJERCICIOS (Física):
- Si el contenido tiene ecuaciones/fórmulas: enunciado_texto, enunciado_latex, pasos[], pasos_latex[] con 2-3 pasos claros
- Si el contenido es conceptual: enunciado_texto, pasos: [] (pregunta de análisis, sin pasos)
- Decide según el CONTENIDO SUBIDO, no la asignatura
  `;
}

function construirPromptHistoria(): string {
  return `
EJERCICIOS (Historia):
- Cada ejercicio tiene: enunciado_texto, pasos: []
- Preguntas de análisis de eventos o procesos históricos
- SIN pasos (preguntas directas)
  `;
}

function construirPromptLenguaje(): string {
  return `
EJERCICIOS (Lenguaje):
- Cada ejercicio tiene: enunciado_texto, pasos: []
- Preguntas de análisis de textos, comprensión lectora
- SIN pasos (preguntas directas)
  `;
}

function construirPromptIngles(): string {
  return `
EJERCICIOS (Inglés):
- Cada ejercicio tiene: enunciado_texto, pasos: []
- Preguntas de comprensión y análisis en inglés
- SIN pasos (preguntas directas)
  `;
}

function construirPromptBiologia(): string {
  return `
EJERCICIOS (Biología):
- Cada ejercicio tiene: enunciado_texto, pasos: []
- Preguntas de análisis conceptual
- SIN pasos (preguntas directas)
  `;
}

function construirPromptEjercicios(asignatura: string): string {
  if (['Matemáticas', 'Química', 'Física'].includes(asignatura)) {
    return `
EJERCICIOS (con ecuaciones y pasos):
- Cada ejercicio tiene: enunciado_texto, enunciado_latex, pasos[], pasos_latex[]
- Incluye fórmulas/ecuaciones en LaTeX
- 2-3 pasos detallados por ejercicio
    `;
  } else {
    // Historia, Lenguaje, Inglés, Biología
    return `
EJERCICIOS (preguntas de análisis):
- Cada ejercicio tiene: enunciado_texto, pasos: []
- Son preguntas de comprensión/análisis
- SIN pasos (preguntas directas)
    `;
  }
}

function construirPrompt(body: SolicitudPlan, contenido: string): string {
  const ejemploJson = JSON.stringify(EJEMPLO_FORMATO_PLAN, null, 2);

  let promptEjercicios: string;
  switch (body.asignatura) {
    case 'Matemáticas':
      promptEjercicios = construirPromptMatematicas();
      break;
    case 'Química':
      promptEjercicios = construirPromptQuimica();
      break;
    case 'Física':
      promptEjercicios = construirPromptFisica();
      break;
    case 'Historia':
      promptEjercicios = construirPromptHistoria();
      break;
    case 'Lenguaje':
      promptEjercicios = construirPromptLenguaje();
      break;
    case 'Inglés':
      promptEjercicios = construirPromptIngles();
      break;
    case 'Biología':
      promptEjercicios = construirPromptBiologia();
      break;
    default:
      promptEjercicios = construirPromptEjercicios(body.asignatura);
  }

  return `Eres un diseñador de planes de estudio para 1º medio. Genera un plan de estudio semanal a partir de estos datos:

- Semana: ${body.semana}
- Título de la clase: ${body.titulo}
- Asignatura: ${body.asignatura}
- Contenido visto en clase:
${contenido}

ESTRUCTURA DEL PLAN:
- Entre ${MIN_SESIONES} y ${MAX_SESIONES} sesiones de estudio
- Cada sesión dura MÁXIMO ${MAX_MINUTOS_SESION} minutos
- Cada sesión usa uno de estos niveles de la Taxonomía de Bloom (en orden progresivo): ${NIVELES_BLOOM.join(", ")}
- Las actividades deben avanzar de más simples a más complejas

${promptEjercicios}

EJERCICIOS DE PRÁCTICA (campo "ejercicios_practica", 2-3 por sesión):
- Mismo estilo que los anteriores, pero SIN pasos ni solución: el estudiante los resuelve solo
- Campos: enunciado_texto, enunciado_latex (si aplica)

REGLAS DE LATEX (para enunciado_latex y pasos_latex):
- LaTeX puro: nunca uses $ ni $$
- Cada comando lleva su backslash COMPLETO: \\frac{a}{b}, \\times, \\rightarrow, \\text{...}, \\sqrt{...}
  Nunca los escribas sin la barra ("frac{a}{b}" o "ightarrow" son inválidos)
- Para química, usa notación mhchem: \\ce{H2O}, \\ce{CH4 + 2O2 -> CO2 + 2H2O}
- Antes de responder, revisa que cada \\ que escribiste siga presente en el texto final

FORMATO DE SALIDA:
Responde ÚNICAMENTE con un JSON válido: sin texto antes ni después, sin bloques de markdown (nada de \`\`\`). Sigue EXACTAMENTE esta forma:
${ejemploJson}`;
}

function limpiarJsonCrudo(textoCrudo: string): string {
  let texto = textoCrudo.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  if (!texto.startsWith("{")) {
    const inicio = texto.indexOf("{");
    if (inicio !== -1) {
      texto = texto.substring(inicio);
    }
  }

  if (!texto.endsWith("}")) {
    const fin = texto.lastIndexOf("}");
    if (fin !== -1) {
      texto = texto.substring(0, fin + 1);
    }
  }

  return escaparControlesSinEscapar(texto);
}

// Claude a veces incluye saltos de línea/tabs literales dentro de un campo de texto
// (p. ej. en pasos_latex), lo que rompe JSON.parse porque un string JSON no puede
// contener esos caracteres de control sin escapar. Recorremos carácter a carácter
// llevando el estado "¿estoy dentro de un string?" para escapar solo esos casos,
// sin tocar las comillas que delimitan cada string.
function escaparControlesSinEscapar(texto: string): string {
  let resultado = "";
  let dentroDeString = false;
  let siguienteEscapado = false;

  for (const ch of texto) {
    if (!dentroDeString) {
      if (ch === '"') dentroDeString = true;
      resultado += ch;
      continue;
    }

    if (siguienteEscapado) {
      resultado += ch;
      siguienteEscapado = false;
      continue;
    }

    if (ch === "\\") {
      resultado += ch;
      siguienteEscapado = true;
      continue;
    }

    if (ch === '"') {
      dentroDeString = false;
      resultado += ch;
      continue;
    }

    if (ch === "\n") {
      resultado += "\\n";
      continue;
    }
    if (ch === "\r") {
      resultado += "\\r";
      continue;
    }
    if (ch === "\t") {
      resultado += "\\t";
      continue;
    }

    resultado += ch;
  }

  return resultado;
}

function validarPlan(plan: PlanEstudio, semanaEsperada: number): string | null {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.sesiones)) {
    return "La respuesta no tiene la forma esperada (falta el campo 'sesiones')";
  }

  if (plan.semana !== semanaEsperada) {
    return `La semana del plan (${plan.semana}) no coincide con la solicitada (${semanaEsperada})`;
  }

  if (plan.sesiones.length < MIN_SESIONES || plan.sesiones.length > MAX_SESIONES) {
    return `El plan tiene ${plan.sesiones.length} sesiones; se esperaban entre ${MIN_SESIONES} y ${MAX_SESIONES}`;
  }

  for (const sesion of plan.sesiones) {
    if (sesion.tiempo_minutos > MAX_MINUTOS_SESION || sesion.tiempo_minutos <= 0) {
      return `La sesión ${sesion.numero} tiene ${sesion.tiempo_minutos} minutos; el máximo permitido es ${MAX_MINUTOS_SESION}`;
    }
    if (!NIVELES_BLOOM.includes(sesion.nivel_bloom)) {
      return `La sesión ${sesion.numero} tiene un nivel Bloom inválido: ${sesion.nivel_bloom}`;
    }
  }

  for (const sesion of plan.sesiones) {
    if (!sesion.ejercicios || sesion.ejercicios.length === 0) {
      return `Sesión ${sesion.numero} sin ejercicios`;
    }

    for (const ej of sesion.ejercicios) {
      if (!ej.enunciado_texto) {
        return `Ejercicio mal formado en sesión ${sesion.numero}: falta enunciado_texto`;
      }
      // enunciado_latex es opcional (para Historia, Lenguaje, etc.)

      // Los pasos son opcionales (para Historia, Lenguaje, etc.)
      if (ej.pasos && !Array.isArray(ej.pasos)) {
        return `Ejercicio mal formado en sesión ${sesion.numero}: pasos debe ser array`;
      }
    }
  }

  return null;
}

async function generarPlanConClaude(body: SolicitudPlan): Promise<PlanEstudio> {
  const contenido = construirContenidoClase(body);
  const prompt = construirPrompt(body, contenido);

  const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeApiKey) {
    throw new Error("ANTHROPIC_API_KEY no está configurada");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": claudeApiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: CLAUDE_MAX_TOKENS,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${await response.text()}`);
  }

  const data = await response.json();
  console.log('Respuesta Claude completa:', JSON.stringify(data, null, 2));

  if (data.stop_reason === "max_tokens") {
    throw new Error(
      `La respuesta de Claude se cortó por límite de tokens (max_tokens: ${CLAUDE_MAX_TOKENS}). Sube CLAUDE_MAX_TOKENS o reduce el tamaño del plan solicitado.`,
    );
  }

  let plan: PlanEstudio;
  try {
    console.log('Response data:', JSON.stringify(data, null, 2));

    if (!data.content || !Array.isArray(data.content)) {
      throw new Error(`Invalid response structure: ${JSON.stringify(data)}`);
    }

    // Buscar el bloque de tipo "text"
    const textContent = data.content.find((c: any) => c.type === 'text');

    if (!textContent || textContent.type !== 'text') {
      throw new Error(`No text content found in response. Types: ${data.content.map((c: any) => c.type).join(', ')}`);
    }

    const content = textContent.text;
    if (!content) {
      throw new Error('Text content is empty');
    }

    const cleanContent = limpiarJsonCrudo(content);
    plan = JSON.parse(cleanContent);
  } catch (error) {
    console.error('Detailed error:', error instanceof Error ? error.message : error, 'Data was:', data);
    throw error;
  }

  const errorValidacion = validarPlan(plan, body.semana);
  if (errorValidacion) {
    throw new Error(`Plan generado inválido: ${errorValidacion}`);
  }

  return plan;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Método no permitido" }), {
      status: 405,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  let body: SolicitudPlan;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Cuerpo de la solicitud no es JSON válido" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  if (!body.semana || body.semana < 1 || body.semana > 40) {
    return new Response(
      JSON.stringify({ error: "El campo 'semana' es requerido y debe estar entre 1 y 40" }),
      { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  if (!body.titulo?.trim()) {
    return new Response(JSON.stringify({ error: "El campo 'titulo' es requerido" }), {
      status: 400,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }

  const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!claudeApiKey) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  let plan: PlanEstudio;
  try {
    plan = await generarPlanConClaude(body);
  } catch (error) {
    console.error("Error generando el plan con Claude:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Error generando el plan" }),
      { status: 502, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }

  // El guardado en planes_estudio ahora lo hace el cliente (frontend/admin.js)
  // después de recibir el plan; esta función solo genera y retorna el plan.

  return new Response(JSON.stringify(plan), {
    status: 200,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
});
