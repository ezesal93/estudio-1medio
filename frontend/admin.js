import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FECHA_INICIO = new Date(2026, 7, 31);

function obtenerRangoSemana(numeroSemana) {
  const inicio = new Date(FECHA_INICIO);
  inicio.setDate(inicio.getDate() + (numeroSemana - 1) * 7);

  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 4);

  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  const inicioStr = `${inicio.getDate()} ${meses[inicio.getMonth()]}`;
  const finStr = `${fin.getDate()} ${meses[fin.getMonth()]}`;

  return `${inicioStr} - ${finStr}`;
}

// Llenar dropdown
document.addEventListener('DOMContentLoaded', () => {
  const select = document.getElementById('numero-semana');
  for (let i = 1; i <= 20; i++) {
    const option = document.createElement('option');
    option.value = i;
    option.textContent = `Semana ${i}: ${obtenerRangoSemana(i)}`;
    select.appendChild(option);
  }
});

// SUPABASE_URL y SUPABASE_ANON_KEY vienen de frontend/config.js (no se sube a git).
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Faltan las credenciales de Supabase. Copia frontend/config.example.js como frontend/config.js y completa los valores."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_BUCKET = "contenido-clases";
const HISTORIAL_KEY = "admin-historial-planes";
const MAX_HISTORIAL = 5;

// ---- Referencias al DOM ----
const form = document.getElementById("form-contenido");
const inputSemana = document.getElementById("numero-semana");
const inputTitulo = document.getElementById("titulo-clase");
const inputAsignatura = document.getElementById("asignatura");
const inputArchivos = document.getElementById("archivos-clase");
const listaArchivos = document.getElementById("lista-archivos");
const inputVideo = document.getElementById("enlace-video");
const textareaContenido = document.getElementById("contenido-clase");
const btnGenerar = document.getElementById("btn-generar-plan");

const estadoLoading = document.getElementById("estado-loading");
const estadoExito = document.getElementById("estado-exito");
const estadoError = document.getElementById("estado-error");
const estadoErrorMensaje = document.getElementById("estado-error-mensaje");

const planGenerado = document.getElementById("plan-generado");
const planTemaPrincipal = document.getElementById("plan-tema-principal");
const planSesiones = document.getElementById("plan-sesiones");

const historialBody = document.getElementById("historial-planes");

let archivosSeleccionados = [];

// ---- Estado visual (loading / éxito / error) ----
function ocultarEstados() {
  [estadoLoading, estadoExito, estadoError].forEach((el) => {
    el.classList.add("hidden");
    el.classList.remove("flex");
  });
}

function mostrarLoading() {
  ocultarEstados();
  estadoLoading.classList.remove("hidden");
  estadoLoading.classList.add("flex");
}

function mostrarExito() {
  ocultarEstados();
  estadoExito.classList.remove("hidden");
  estadoExito.classList.add("flex");
}

function mostrarError(mensaje) {
  ocultarEstados();
  estadoErrorMensaje.textContent = mensaje || "Ocurrió un error al generar el plan";
  estadoError.classList.remove("hidden");
  estadoError.classList.add("flex");
}

// ---- Lista visual de archivos seleccionados ----
function iconoParaArchivo(archivo) {
  if (archivo.type.includes("pdf")) return "📄";
  if (archivo.type.includes("image")) return "🖼️";
  if (archivo.type.includes("word") || /\.docx?$/i.test(archivo.name)) return "📝";
  return "📎";
}

function renderListaArchivos() {
  listaArchivos.innerHTML = "";

  archivosSeleccionados.forEach((archivo, index) => {
    const item = document.createElement("li");
    item.className =
      "flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm";

    const info = document.createElement("span");
    info.className = "flex items-center gap-2 text-slate-700 truncate";
    info.innerHTML = `<span>${iconoParaArchivo(archivo)}</span><span class="truncate">${archivo.name}</span>`;

    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-quitar-archivo text-slate-400 hover:text-red-500 text-xs font-semibold shrink-0";
    btnQuitar.textContent = "Quitar";
    btnQuitar.addEventListener("click", () => {
      archivosSeleccionados.splice(index, 1);
      renderListaArchivos();
    });

    item.append(info, btnQuitar);
    listaArchivos.appendChild(item);
  });
}

inputArchivos.addEventListener("change", () => {
  archivosSeleccionados = Array.from(inputArchivos.files);
  renderListaArchivos();
});

// ---- Subir archivos a Supabase Storage ----
async function subirArchivos(archivos, semana) {
  const subidos = [];

  for (const archivo of archivos) {
    // Sanitizar nombre del archivo (quitar caracteres especiales)
    const nombreLimpio = archivo.name
      .replace(/[^a-zA-Z0-9.]/g, "_") // Reemplaza caracteres especiales con _
      .replace(/_+/g, "_") // Evita múltiples _ seguidos
      .toLowerCase();

    const ruta = `semana-${semana}/${Date.now()}-${nombreLimpio}`;

    const { error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(ruta, archivo, { cacheControl: "3600", upsert: false });

    if (error) {
      throw new Error(`No se pudo subir "${archivo.name}": ${error.message}`);
    }

    const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(ruta);

    subidos.push({ nombre: archivo.name, tipo: archivo.type, url: data.publicUrl });
  }

  return subidos;
}

// ---- Extraer contenido de los archivos subidos ----
let pdfjsLibPromise;

async function cargarPdfjs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import("https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/+esm").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc =
        "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs";
      return pdfjs;
    });
  }
  return pdfjsLibPromise;
}

async function extraerTextoPDF(urlPDF) {
  try {
    const pdfjs = await cargarPdfjs();
    const pdf = await pdfjs.getDocument(urlPDF).promise;
    let texto = "";

    for (let numPagina = 1; numPagina <= pdf.numPages; numPagina++) {
      const pagina = await pdf.getPage(numPagina);
      const contenido = await pagina.getTextContent();
      texto += contenido.items.map((item) => item.str).join(" ") + "\n";
    }

    return texto.trim();
  } catch (error) {
    console.warn(`No se pudo extraer texto del PDF "${urlPDF}": ${error.message}`);
    return null;
  }
}

async function extraerContenidoArchivos(archivosSubidos) {
  const textos = [];
  const imagenes = [];

  for (const archivo of archivosSubidos) {
    if (archivo.tipo === "application/pdf") {
      const texto = await extraerTextoPDF(archivo.url);
      if (texto) textos.push({ nombre: archivo.nombre, texto });
    } else if (archivo.tipo.includes("image")) {
      imagenes.push({ nombre: archivo.nombre, url: archivo.url });
    }
  }

  return { textos, imagenes };
}

// ---- Llamar a la Supabase Function "generate-plan" ----
async function generarPlan({ semana, titulo, asignatura, notas, enlaceVideo, archivosSubidos, textos, imagenes }) {
  const respuesta = await fetch(`${SUPABASE_URL}/functions/v1/generate-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      semana: Number(semana),
      titulo,
      asignatura, // AGREGAR ESTA LÍNEA
      notas,
      video: enlaceVideo || null,
      archivos: archivosSubidos,
      textosExtraidos: textos,
      imagenes,
    }),
  });

  if (!respuesta.ok) {
    const detalle = await respuesta.text().catch(() => "");
    throw new Error(`generate-plan respondió ${respuesta.status}: ${detalle || "sin detalle"}`);
  }

  const data = await respuesta.json();

  // Guardar plan en Supabase
  console.log(
    "Datos a guardar:",
    JSON.stringify(
      {
        semana: parseInt(semana, 10),
        titulo: titulo,
        asignatura: asignatura,
        tema_principal: data.tema_principal,
        contenido_generado: data,
      },
      null,
      2
    )
  );

  const { error: insertError } = await supabase
    .from("planes_estudio")
    .insert({
      semana: parseInt(semana, 10),
      titulo: titulo,
      asignatura: asignatura,
      tema_principal: data.tema_principal,
      contenido_generado: data,
    })
    .select();

  if (insertError) {
    console.error("Error guardando plan:", insertError);
  } else {
    console.log("Plan guardado correctamente");
  }

  return data;
}

// ---- Mostrar el plan generado en el DOM ----
function mostrarPlanGenerado(plan) {
  planTemaPrincipal.textContent = plan.temaPrincipal || "Tema sin definir";
  planSesiones.innerHTML = "";

  (plan.sesiones || []).forEach((sesion, index) => {
    const card = document.createElement("article");
    card.className = "bg-slate-50 rounded-2xl border border-slate-200 p-5 flex flex-col gap-3";

    const actividades = (sesion.actividades || []).map((actividad) => `<li>${actividad}</li>`).join("");

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <h3 class="text-base font-bold text-slate-800">Sesión ${index + 1}: ${sesion.titulo || ""}</h3>
        <span class="shrink-0 text-xs font-semibold bg-sky-100 text-sky-700 px-3 py-1 rounded-full">
          ⏱ ${sesion.tiempo ?? "-"} min
        </span>
      </div>
      <ul class="text-sm text-slate-600 list-disc list-inside space-y-1">${actividades}</ul>
      <div class="pt-2 border-t border-slate-200">
        <span class="text-xs font-semibold text-slate-500 uppercase tracking-wide">Evaluación</span>
        <p class="text-sm text-slate-600">${sesion.evaluacion || "Sin evaluación definida"}</p>
      </div>
    `;

    planSesiones.appendChild(card);
  });

  planGenerado.classList.remove("hidden");
}

// ---- Historial de últimos planes (localStorage) ----
function leerHistorial() {
  try {
    return JSON.parse(localStorage.getItem(HISTORIAL_KEY)) || [];
  } catch {
    return [];
  }
}

function renderHistorial(historial = leerHistorial()) {
  historialBody.innerHTML = "";

  historial.forEach((item) => {
    const fila = document.createElement("tr");
    fila.innerHTML = `
      <td class="py-3 pr-4 text-slate-700">${item.semana}</td>
      <td class="py-3 pr-4 text-slate-700">${item.titulo}</td>
      <td class="py-3 pr-4 text-slate-500">${item.fecha}</td>
      <td class="py-3 pr-4">
        <span class="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full">
          ${item.estado}
        </span>
      </td>
    `;
    historialBody.appendChild(fila);
  });
}

function guardarEnHistorial({ semana, titulo }) {
  const historial = leerHistorial();

  historial.unshift({
    semana,
    titulo,
    fecha: new Date().toLocaleDateString("es-CL"),
    estado: "Generado",
  });

  const recortado = historial.slice(0, MAX_HISTORIAL);
  localStorage.setItem(HISTORIAL_KEY, JSON.stringify(recortado));
  renderHistorial(recortado);
}

// ---- Flujo principal ----
form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const semana = parseInt(inputSemana.value, 10);
  const titulo = inputTitulo.value.trim();
  const asignatura = inputAsignatura.value;
  const notas = textareaContenido.value.trim();
  const enlaceVideo = inputVideo.value.trim();

  if (!semana || semana < 1 || semana > 40) {
    mostrarError("Ingresa un número de semana entre 1 y 40");
    return;
  }

  if (!titulo) {
    mostrarError("Ingresa el título de la clase");
    return;
  }

  if (!asignatura) {
    mostrarError("Selecciona una asignatura");
    return;
  }

  btnGenerar.disabled = true;
  planGenerado.classList.add("hidden");
  mostrarLoading();

  try {
    const archivosSubidos = archivosSeleccionados.length
      ? await subirArchivos(archivosSeleccionados, semana)
      : [];

    const { textos, imagenes } = await extraerContenidoArchivos(archivosSubidos);

    const plan = await generarPlan({
      semana,
      titulo,
      asignatura,
      notas,
      enlaceVideo,
      archivosSubidos,
      textos,
      imagenes,
    });

    mostrarPlanGenerado(plan);
    mostrarExito();
    guardarEnHistorial({ semana, titulo });

    form.reset();
    archivosSeleccionados = [];
    renderListaArchivos();
  } catch (error) {
    console.error(error);
    mostrarError(error.message);
  } finally {
    btnGenerar.disabled = false;
  }
});

// ---- Inicialización ----
renderHistorial();