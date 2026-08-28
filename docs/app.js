import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FECHA_INICIO = new Date(2026, 7, 31); // 7 = agosto (0-based)

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

// SUPABASE_URL y SUPABASE_ANON_KEY vienen de frontend/config.js (no se sube a git).
const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Faltan las credenciales de Supabase. Copia frontend/config.example.js como frontend/config.js y completa los valores."
  );
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ESTUDIANTE_ID_KEY = "estudiante-id";

const NIVEL_BLOOM_ESTILOS = {
  Recordar: "bg-blue-100 text-blue-700",
  Comprender: "bg-emerald-100 text-emerald-700",
  Aplicar: "bg-amber-100 text-amber-700",
  Analizar: "bg-purple-100 text-purple-700",
};

// ---- Referencias al DOM ----
const semanaNumero = document.getElementById("semana-numero");
const listaSesiones = document.getElementById("lista-sesiones");
const progresoTexto = document.getElementById("progreso-texto");
const barraProgreso = document.getElementById("barra-progreso");

// ---- Estado en memoria ----
let semanaActual = null;
let totalSesiones = 0;
let sesionesCompletadas = new Set();

// ---- Identidad de estudiante (sin login: se guarda un id anónimo por dispositivo) ----
function obtenerEstudianteId() {
  let id = localStorage.getItem(ESTUDIANTE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ESTUDIANTE_ID_KEY, id);
  }
  return id;
}

const estudianteId = obtenerEstudianteId();

// ---- Mostrar el plan de una semana específica (agrupado por asignatura, con tabs por clase) ----
async function mostrarSemana(numeroSemana) {
  // Buscar TODOS los planes de esa semana
  const planesDeLaSemana = window.todosLosPlanes.filter((p) => p.semana === numeroSemana);

  if (planesDeLaSemana.length === 0) {
    listaSesiones.innerHTML = "<p>No hay planes para esta semana</p>";
    return;
  }

  // Actualizar número de semana y semana actual
  semanaNumero.textContent = obtenerRangoSemana(numeroSemana);
  semanaActual = numeroSemana;

  // Agrupar por asignatura
  const porAsignatura = {};
  planesDeLaSemana.forEach((plan) => {
    const asignatura = plan.asignatura || "Sin asignar";
    if (!porAsignatura[asignatura]) {
      porAsignatura[asignatura] = [];
    }
    porAsignatura[asignatura].push(plan);
  });

  // Sesiones actualmente visibles por slug de asignatura (una "clase"/tab a la vez)
  const sesionesVisiblesPorSlug = {};
  const infoPorSlug = {};

  function recalcularTotalSesiones() {
    totalSesiones = Object.values(sesionesVisiblesPorSlug).reduce(
      (total, sesiones) => total + sesiones.length,
      0
    );
  }

  function relanzarKaTeX() {
    if (window.renderMathInElement) {
      renderMathInElement(document.body, {
        delimiters: [
          {left: '\\(', right: '\\)', display: false},
          {left: '\\[', right: '\\]', display: true}
        ]
      });
    }
  }

  // Renderizar cada asignatura como sección
  let html = "";

  for (const [asignatura, planes] of Object.entries(porAsignatura)) {
    const slug = asignatura.toLowerCase().replace(/\s+/g, '-');
    infoPorSlug[slug] = planes;

    html += `<div class="sm:col-span-2" data-asignatura-slug="${slug}">`;
    html += `<h3 class="text-lg font-bold mt-6 mb-3 text-blue-600 border-b-2 pb-2">📚 ${asignatura}</h3>`;

    // Si hay múltiples planes de la misma asignatura, mostrar tabs
    if (planes.length > 1) {
      html += '<div class="mb-3 flex gap-2">';
      planes.forEach((plan, index) => {
        const activo = index === 0;
        html += `
          <button
            type="button"
            class="plan-tab px-3 py-1 rounded border text-sm ${activo ? "bg-blue-500 text-white" : ""}"
            data-asignatura-slug="${slug}"
            data-index="${index}"
          >
            Clase ${index + 1}
          </button>
        `;
      });
      html += "</div>";
    }

    // Mostrar sesiones del primer plan por defecto
    const planActual = planes[0];
    const sesiones = planActual.contenido_generado?.sesiones || [];
    sesionesVisiblesPorSlug[slug] = sesiones;

    html += `<div id="sesiones-${slug}" class="grid grid-cols-1 sm:grid-cols-2 gap-5">`;
    sesiones.forEach((sesion) => {
      html += renderizarSesion(sesion);
    });
    html += "</div>";

    html += "</div>";
  }

  listaSesiones.innerHTML = html;

  // Extraer asignaturas únicas de la semana
  const asignaturas = [...new Set(planesDeLaSemana.map(p => p.asignatura || 'Sin asignar'))];

  // Generar tabs
  const tabsContainer = document.getElementById('tabs-asignaturas');
  tabsContainer.innerHTML = '';

  asignaturas.forEach(asignatura => {
    const tab = document.createElement('button');
    tab.textContent = asignatura;
    tab.className = 'px-4 py-2 rounded border border-blue-500 text-blue-600 hover:bg-blue-50 transition';
    tab.dataset.asignatura = asignatura;

    tab.addEventListener('click', () => {
      filtrarPorAsignatura(asignatura);
    });

    tabsContainer.appendChild(tab);
  });

  recalcularTotalSesiones();

  // Event listeners para tabs (cambiar de "clase" dentro de una misma asignatura)
  document.querySelectorAll(".plan-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const boton = e.currentTarget;
      const slug = boton.dataset.asignaturaSlug;
      const index = parseInt(boton.dataset.index, 10);
      const planSeleccionado = infoPorSlug[slug][index];

      // Actualizar botones activos (solo dentro de esta asignatura)
      document.querySelectorAll(`.plan-tab[data-asignatura-slug="${slug}"]`).forEach((b) => {
        b.classList.remove("bg-blue-500", "text-white");
      });
      boton.classList.add("bg-blue-500", "text-white");

      // Renderizar las sesiones del plan seleccionado (sesionesCompletadas ya está cargado)
      const sesiones = planSeleccionado.contenido_generado?.sesiones || [];
      sesionesVisiblesPorSlug[slug] = sesiones;

      const contenedorSesiones = document.getElementById(`sesiones-${slug}`);
      contenedorSesiones.innerHTML = sesiones.map((sesion) => renderizarSesion(sesion)).join("");

      recalcularTotalSesiones();
      relanzarKaTeX();
    });
  });

  console.log('🔄 Intentando procesar ecuaciones con MathJax...');
  relanzarKaTeX();
  console.log('✓ relanzarMathJax() ejecutado');
}

// ---- Cargar todos los planes de estudio ----
async function cargarTodasLasSemanas() {
  try {
    // Traer TODOS los planes ordenados por semana DESC
    const { data, error } = await supabase
      .from("planes_estudio")
      .select("*")
      .order("semana", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      document.getElementById("lista-sesiones").innerHTML =
        "<p>No hay planes disponibles</p>";
      return;
    }

    // Guardar todos los planes
    window.todosLosPlanes = data;

    // Llenar dropdown de semanas
    const selector = document.getElementById("selector-semana");
    selector.innerHTML = ""; // Limpiar

    // Agrupar planes por semana
    const semanas = [...new Set(data.map((p) => p.semana))].sort((a, b) => b - a);

    semanas.forEach((semana) => {
      const option = document.createElement("option");
      option.value = semana;
      option.textContent = `Semana ${semana}: ${obtenerRangoSemana(semana)}`;
      selector.appendChild(option);
    });

    // Seleccionar la primera semana por defecto
    if (semanas.length > 0) {
      selector.value = semanas[0];
      mostrarSemana(semanas[0]);
    }

    // Event listener: cuando cambia la semana
    selector.addEventListener("change", (e) => {
      if (e.target.value) {
        mostrarSemana(parseInt(e.target.value, 10));
      }
    });
  } catch (error) {
    console.error("Error cargando planes:", error);
  }
}

// ---- Pintar las sesiones en cards ----
function mostrarMensajeSesiones(mensaje) {
  listaSesiones.innerHTML = `<p class="text-sm text-slate-500 sm:col-span-2">${mensaje}</p>`;
}

function limpiarLatex(latex) {
  if (!latex) return latex;
  // Elimina $$ al inicio y final
  return latex.replace(/^\$\$/, '').replace(/\$\$$/, '');
}

function renderizarSesion(sesion) {
  let ejerciciosHTML = '';
  if (sesion.ejercicios && sesion.ejercicios.length > 0) {
    ejerciciosHTML = '<div class="mt-4"><strong>Ejercicios:</strong>';
    sesion.ejercicios.forEach((ej, i) => {
      ejerciciosHTML += `
        <div class="mt-3 p-3 bg-blue-50 rounded border-l-4 border-blue-500">
          <p class="font-semibold text-sm">Ejercicio ${i+1}: ${ej.enunciado_texto}</p>
          ${ej.enunciado_latex ? `<div class="mt-1 text-sm">\\[${limpiarLatex(ej.enunciado_latex)}\\]</div>` : ''}
          <p class="text-xs text-gray-600 mt-2"><strong>Pasos:</strong></p>
          <ol class="text-xs ml-4 list-decimal">
            ${ej.pasos.map((paso, j) => `
              <li>${paso}
              ${ej.pasos_latex && ej.pasos_latex[j] ? `<div class="mt-1">\\[${limpiarLatex(ej.pasos_latex[j])}\\]</div>` : ''}
              </li>
            `).join('')}
          </ol>
        </div>
      `;
    });
    ejerciciosHTML += '</div>';
  }

  return `
    <article class="sesion-card bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="inline-block px-2 py-1 bg-blue-100 text-blue-600 text-xs font-semibold rounded mb-2">SESIÓN ${sesion.numero}</span>
          <h3 class="text-lg font-bold text-slate-800">${sesion.titulo}</h3>
        </div>
        <span class="text-sm text-gray-500">⏱ ${sesion.tiempo_minutos} min</span>
      </div>
      <span class="inline-block px-2 py-1 mt-2 text-xs font-semibold rounded" style="background-color: var(--color-bloom-${sesion.nivel_bloom.toLowerCase()}); color: white;">${sesion.nivel_bloom}</span>
      <div class="mt-3">
        <p class="text-sm font-semibold text-gray-700 mb-2">Objetivos:</p>
        <ul class="text-sm text-gray-600 list-disc ml-5">
          ${sesion.objetivos.map(obj => `<li>${obj}</li>`).join('')}
        </ul>
      </div>
      <div class="mt-3">
        <p class="text-sm font-semibold text-gray-700 mb-2">Actividades:</p>
        <ul class="text-sm text-gray-600 list-disc ml-5">
          ${sesion.actividades.map(act => `<li>${act}</li>`).join('')}
        </ul>
      </div>
      ${ejerciciosHTML}
      <div class="mt-3">
        <p class="text-sm font-semibold text-gray-700 mb-2">Evaluación:</p>
        <p class="text-sm text-gray-600">${sesion.evaluacion}</p>
      </div>
      ${sesion.ejercicios_practica && sesion.ejercicios_practica.length > 0 ? `
        <div class="mt-4 p-3 bg-yellow-50 rounded border-l-4 border-yellow-500">
          <p class="font-semibold text-sm text-yellow-800">📝 Ejercicios para Practicar:</p>
          ${sesion.ejercicios_practica.map((ej, i) => `
            <div class="mt-2">
              <p class="text-sm font-semibold">Ejercicio ${i+1}: ${ej.enunciado_texto}</p>
              ${ej.enunciado_latex ? `<div class="text-sm">\\[${limpiarLatex(ej.enunciado_latex)}\\]</div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

function renderSesiones(sesiones) {
  listaSesiones.innerHTML = "";

  if (!sesiones.length) {
    mostrarMensajeSesiones("El plan de esta semana no tiene sesiones cargadas.");
    return;
  }

  sesiones.forEach((sesion) => {
    const completada = sesionesCompletadas.has(sesion.numero);
    const claseNivelBloom = NIVEL_BLOOM_ESTILOS[sesion.nivel_bloom] || "bg-slate-100 text-slate-700";

    const actividades = (sesion.actividades || [])
      .map((actividad) => `<li>${actividad}</li>`)
      .join("");

    // Mostrar ejercicios con paso a paso
    let ejerciciosHTML = "";
    if (sesion.ejercicios && sesion.ejercicios.length > 0) {
      ejerciciosHTML = '<div class="mt-4"><strong>Ejercicios:</strong>';

      for (let i = 0; i < sesion.ejercicios.length; i++) {
        const ej = sesion.ejercicios[i];
        const enunciado = procesarEcuaciones(ej.enunciado);
        const pasosHTML = ej.pasos
          .map((paso) => {
            const pasoProcesado = procesarEcuaciones(paso);
            return `<li>${pasoProcesado}</li>`;
          })
          .join("");

        ejerciciosHTML += `
          <div class="mt-2 p-2 bg-blue-50 rounded border-l-4 border-blue-500">
            <p class="font-semibold text-sm">Ejercicio ${i + 1}: ${enunciado}</p>
            <p class="text-xs text-gray-600 mt-1"><strong>Pasos:</strong></p>
            <ol class="text-xs ml-4 list-decimal">
              ${pasosHTML}
            </ol>
          </div>
        `;
      }

      ejerciciosHTML += "</div>";
    }

    const card = document.createElement("article");
    card.className = "sesion-card bg-white rounded-2xl shadow-sm border border-slate-200 p-5 flex flex-col gap-4";

    card.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <span class="text-xs font-semibold text-indigo-500 uppercase tracking-wide">Sesión ${sesion.numero}</span>
          <h3 class="text-lg font-bold text-slate-800">${sesion.titulo}</h3>
        </div>
        <span class="shrink-0 text-xs font-semibold bg-sky-100 text-sky-700 px-3 py-1 rounded-full">
          ⏱ ${sesion.tiempo_minutos} min
        </span>
      </div>

      <span class="self-start text-xs font-semibold ${claseNivelBloom} px-3 py-1 rounded-full">
        ${sesion.nivel_bloom}
      </span>

      <ul class="text-sm text-slate-600 list-disc list-inside space-y-1">${actividades}</ul>

      ${ejerciciosHTML}

      <button
        type="button"
        class="btn-completar mt-auto w-full font-semibold py-2.5 rounded-xl transition-colors ${
          completada
            ? "bg-emerald-500 text-white cursor-default"
            : "bg-indigo-600 hover:bg-indigo-700 text-white"
        }"
        data-sesion-numero="${sesion.numero}"
        ${completada ? "disabled" : ""}
      >
        ${completada ? "✓ Completada" : "Marcar como completada"}
      </button>
    `;

    listaSesiones.appendChild(card);
  });

  // Esperar a que MathJax esté listo
  if (window.MathJax) {
    window.MathJax.startup.promise.then(() => {
      MathJax.typesetPromise().catch((err) => console.log(err));
    });
  } else {
    // Si MathJax no cargó, reintentar en 500ms
    setTimeout(() => {
      if (window.MathJax) {
        MathJax.typesetPromise().catch((err) => console.log(err));
      }
    }, 500);
  }

  // Forzar a MathJax a procesar todo el contenido
  setTimeout(() => {
    if (window.MathJax) {
      window.MathJax.typesetPromise()
        .catch((err) => console.log("MathJax error:", err));
    }
  }, 100);
}

// ---- Inicialización ----
cargarTodasLasSemanas();

function filtrarPorAsignatura(asignatura) {
  // Ocultar todas las asignaturas
  const todosLosBlocks = document.querySelectorAll('[data-asignatura-slug]');
  todosLosBlocks.forEach(block => {
    block.style.display = 'none';
  });

  // Mostrar solo la seleccionada
  const bloqueSeleccionado = document.querySelector(`[data-asignatura-slug="${asignatura.toLowerCase().replace(/\s+/g, '-')}"]`);
  if (bloqueSeleccionado) {
    bloqueSeleccionado.style.display = 'block';
  }

  // Actualizar tab activo
  document.querySelectorAll('#tabs-asignaturas button').forEach(btn => {
    btn.classList.remove('bg-blue-500', 'text-white');
    if (btn.dataset.asignatura === asignatura) {
      btn.classList.add('bg-blue-500', 'text-white');
    }
  });
}