/* Mimo -> CodeRuta converter
   Lee data/raw/lessons-es/tracks/*.json (extraidos del APK) y genera:
     data/index.js        -> window.CR_INDEX  (pistas + metadatos de lecciones)
     data/track-<id>.js   -> window.CR_BEATS  (beats por leccion, agrupados por pista "home")
   Contenido ADAPTADO: se conservan ejercicios/codigo (funcionales) y se genera prosa propia.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RAW = path.join(ROOT, 'data', 'raw', 'lessons-es', 'tracks');
const OUT = path.join(ROOT, 'data');

/* Plantilla propia para las vistas previas (no se copia el contenido demo original) */
const PREVIEW_TEMPLATE = [
  '<!DOCTYPE html>',
  '<html>',
  '<head>',
  '  <meta charset="utf-8">',
  '  <style>',
  '    body { font-family: system-ui, sans-serif; padding: 16px; }',
  '    h1 { color: #2563eb; }',
  '    .caja { background: #eef2ff; padding: 12px; border-radius: 8px; }',
  '  </style>',
  '</head>',
  '<body>',
  '  <h1>Mi página</h1>',
  '  <div class="caja">Edita el HTML y el CSS y observa el resultado.</div>',
  '</body>',
  '</html>'
].join('\n');

/* ------------------------- utils ------------------------- */
function decode(s){
  return String(s == null ? '' : s)
    .replace(/&#x([0-9a-fA-F]+);/g, (m,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&#(\d+);/g, (m,d)=>String.fromCharCode(+d))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&apos;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&');
}
function escapeHtml(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function stripTags(html){ return decode(String(html||'').replace(/<[^>]*>/g,'')).replace(/\s+/g,' ').trim(); }
function attr(tag, name){
  const m = String(tag).match(new RegExp(name+'\\s*=\\s*"([^"]*)"', 'i'));
  return m ? decode(m[1]) : null;
}
function keyTerms(html){
  const out=[]; const re=/<code>([\s\S]*?)<\/code>/gi; let m;
  while((m=re.exec(html||''))){ const t=stripTags(m[1]).trim(); if(t && out.indexOf(t)<0) out.push(t); }
  return out;
}
const BRANDS = [[/\bfacebook\b/gi,'MiApp'],[/\btelegram\b/gi,'MiApp'],[/\binstagram\b/gi,'MiApp'],[/\bnetflix\b/gi,'MiApp'],[/\bgoogle\b/gi,'MiApp'],[/\byoutube\b/gi,'MiApp'],[/\btwitter\b/gi,'MiApp']];
function sanitize(s){
  let x = String(s==null?'':s);
  x = x.replace(/https?:\/\/mimo\.app\/[^\s"'<>)]*/gi, 'https://picsum.photos/300/200');
  for(const [re,rep] of BRANDS) x = x.replace(re, rep);
  return x;
}
function codeLangOf(lang){
  const map = {javascript:'js', js:'js', jsx:'js', node:'js', typescript:'ts', html:'html', css:'css', python:'python', sql:'sql', swift:'swift', json:'json', bash:'bash'};
  return map[String(lang||'').toLowerCase()] || 'js';
}

/* ------------------- parser de interactiveContent ------------------- */
// Devuelve lista ordenada de bloques: {t:'p'|'code'|'selection'|'webview', ...}
function parseBlocks(html){
  let inner = String(html||'');
  const bm = inner.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if(bm) inner = bm[1];
  const blocks=[];
  const re = /(<code\b[^>]*\bversion=[^>]*>[\s\S]*?<\/code>)|(<selection\b[^>]*>[\s\S]*?<\/selection>)|(<p\b[^>]*>[\s\S]*?<\/p>)|(<webview\b[^>]*?\/?>)/gi;
  let m;
  while((m=re.exec(inner))){
    const raw = m[0];
    if(m[1]){ const b = parseCodeBlock(raw); if(b) blocks.push(b); }
    else if(m[2]){ const b = parseSelection(raw); if(b) blocks.push(b); }
    else if(m[3]){ blocks.push(parseP(raw)); }
    else if(m[4]){ blocks.push(parseWebview(raw)); }
  }
  return blocks;
}
function parseP(raw){
  const openTag = raw.slice(0, raw.indexOf('>')+1);
  const wrong = /visible-if\s*=\s*"wrong"/i.test(openTag);
  const text = raw.replace(/^<p[^>]*>/i,'').replace(/<\/p>$/i,'');
  return {t:'p', wrong, text};
}
function parseWebview(raw){
  const content = attr(raw, 'content');
  return {t:'webview', content: sanitize(decode(content))};
}
function parseSelection(raw){
  const openTag = raw.slice(0, raw.indexOf('>')+1);
  const items=[]; const ire=/<item\b([^>]*)>([\s\S]*?)<\/item>/gi; let m;
  while((m=ire.exec(raw))){
    items.push({ value: attr('<item '+m[1]+'>','value'), correct: /correct\s*=\s*"true"/i.test(m[1]), text: stripTags(m[2]) });
  }
  if(!items.length) return null;
  let answer = items.findIndex(it=>it.correct);
  if(answer<0) answer = 0;
  return {t:'selection', iscode: attr(openTag,'iscode')==='true', options: items.map(it=>it.text), answer};
}
function parseCodeBlock(raw){
  const openTag = raw.slice(0, raw.indexOf('>')+1);
  const inner = raw.replace(/^<code[^>]*>/i,'').replace(/<\/code>$/i,'');
  // <content> tokens -> codeStr
  const cm = inner.match(/<content>([\s\S]*?)<\/content>/i);
  let codeStr='';
  if(cm){
    const tre=/<text\b([^>]*?)\/?>(?:<\/text>)?/gi; let tm;
    while((tm=tre.exec(cm[1]))){
      const a = tm[1]||'';
      if(/type\s*=\s*"break"/i.test(a)) codeStr += '\n';
      else { const v = attr('<text '+a+'>','value'); codeStr += (v==null?'':v); }
    }
  }
  // interactions
  const gaps=[]; let validated=null; const distractors=[];
  const im = inner.match(/<interactions>([\s\S]*?)<\/interactions>/i);
  if(im){
    const ire=/<interaction\b([^>]*?)(\/?)>([\s\S]*?)<\/interaction>|<interaction\b([^>]*?)\/>/gi; let x;
    while((x=ire.exec(im[1]))){
      const attrs = x[1]!=null ? x[1] : x[4];
      const body = x[3]||'';
      const type = attr('<interaction '+attrs+'>','type');
      if(type==='validatedInput'){
        const s=parseInt(attr('<i '+attrs+'>','startIndex'),10), e=parseInt(attr('<i '+attrs+'>','endIndex'),10);
        if(!isNaN(s)&&!isNaN(e)) validated={s,e,token: codeStr.slice(s,e)};
      } else if(type==='fillTheGap'){
        const ore=/<option\b([^>]*?)(\/?)>([\s\S]*?)<\/option>|<option\b([^>]*?)\/>/gi; let o;
        while((o=ore.exec(body))){
          const oa = o[1]!=null ? o[1] : o[4];
          const ob = o[3]||'';
          const s=parseInt(attr('<o '+oa+'>','startIndex'),10), e=parseInt(attr('<o '+oa+'>','endIndex'),10);
          const isFalse = /correct\s*=\s*"false"/i.test(oa);
          if(isFalse){
            const cmt = ob.match(/<text\b([^>]*)\/?>/i);
            const dv = cmt? attr(cmt[0],'value') : stripTags(ob);
            if(dv!=null && dv!=='') distractors.push(dv);
          } else if(!isNaN(s)&&!isNaN(e)){
            gaps.push({s,e,token: codeStr.slice(s,e)});
          }
        }
      }
    }
  }
  gaps.sort((a,b)=>a.s-b.s);
  return {t:'code', codeStr, gaps, validated, distractors, codeLanguage: attr(openTag,'codelang')};
}

/* ------------------- conversion a beats ------------------- */
function withGaps(codeStr, gaps){
  let out='', prev=0;
  for(const g of gaps){ if(g.s<prev) continue; out += codeStr.slice(prev,g.s)+'@@'; prev=g.e; }
  out += codeStr.slice(prev);
  return out;
}
function withGap(codeStr, sp){
  return codeStr.slice(0,sp.s) + '____' + codeStr.slice(sp.e);
}
/* Texto propio por concepto: [idea principal, detalle] */
const TOPIC_TEXT = {
  variables:    ['Una variable guarda un valor con un nombre para usarlo más tarde.', 'Se crea con <code>let</code>, o con <code>const</code> si no va a cambiar.'],
  constants:    ['Una constante guarda un valor que no debe cambiar.', 'Se declara con <code>const</code> y protege el dato de cambios accidentales.'],
  functions:    ['Una función agrupa instrucciones y las reutiliza cuando la llamas.', 'Puede recibir datos (parámetros) y devolver un resultado con <code>return</code>.'],
  arrow:        ['Una función flecha es una forma corta de escribir una función.', 'Se escribe con <code>=&gt;</code> y hereda el valor de <code>this</code> del contexto.'],
  loops:        ['Un bucle repite instrucciones sin que las escribas otra vez.', '<code>for</code> recorre una secuencia y <code>while</code> repite mientras se cumpla una condición.'],
  conditionals: ['Una condición decide qué camino tomar según se cumpla o no.', 'Se escribe con <code>if</code>, <code>else if</code> y <code>else</code>.'],
  print:        ['Mostrar resultados te ayuda a comprobar qué hace tu programa.', 'En JavaScript se usa <code>console.log()</code>; en Python, <code>print()</code>.'],
  arrays:       ['Un arreglo (o lista) guarda varios valores en orden.', 'Accedes a cada elemento por su posición, empezando en 0.'],
  objects:      ['Un objeto guarda datos con nombre (clave y valor).', 'Accedes a sus datos con un punto, por ejemplo <code>persona.nombre</code>.'],
  strings:      ['Un texto (string) es una cadena de caracteres entre comillas.', 'Puedes unir textos con <code>+</code> o con plantillas.'],
  numbers:      ['Los números permiten calcular: sumar, restar, multiplicar y dividir.', 'Puedes guardar el resultado en una variable para usarlo después.'],
  classes:      ['Una clase es un molde para crear objetos con las mismas propiedades y acciones.', 'Se define con <code>class</code> y se usa con <code>new</code>.'],
  modules:      ['Los módulos dividen el código en archivos reutilizables.', 'Se importan y exportan para compartir funciones y datos.'],
  sqlSelect:    ['<code>SELECT</code> elige las columnas que quieres ver de una tabla.', 'Se combina con <code>FROM</code> para indicar de dónde salen los datos.'],
  sqlWhere:     ['<code>WHERE</code> filtra las filas que cumplen una condición.', 'Así obtienes solo los datos que te interesan.'],
  sqlJoin:      ['<code>JOIN</code> une datos de dos tablas relacionadas.', 'Se indica la condición que relaciona ambas tablas.'],
  sqlInsert:    ['<code>INSERT</code> agrega filas nuevas a una tabla.', 'Indicas las columnas y los valores que quieres guardar.'],
  sqlUpdate:    ['<code>UPDATE</code> cambia datos que ya existen.', 'Casi siempre se acompaña de <code>WHERE</code> para no modificar todo.'],
  sqlDelete:    ['<code>DELETE</code> elimina filas de una tabla.', 'Usa <code>WHERE</code> para borrar solo lo que necesitas.'],
  htmlTitles:   ['Los títulos organizan la página por importancia.', '<code>&lt;h1&gt;</code> es el principal y <code>&lt;h6&gt;</code> el de menor nivel.'],
  htmlText:     ['Los párrafos agrupan texto y las etiquetas de énfasis resaltan ideas.', 'Se usan <code>&lt;p&gt;</code>, <code>&lt;strong&gt;</code> y <code>&lt;em&gt;</code>.'],
  htmlLinks:    ['Los enlaces conectan una página con otra.', 'Se crean con <code>&lt;a href="..."&gt;</code> y el texto visible dentro.'],
  htmlImages:   ['Las imágenes se muestran con la etiqueta <code>&lt;img&gt;</code>.', 'El atributo <code>src</code> indica la dirección y <code>alt</code> describe la imagen.'],
  htmlLists:    ['Las listas ordenan elementos en filas.', 'Usa <code>&lt;ul&gt;</code> para viñetas y <code>&lt;ol&gt;</code> para listas numeradas, con <code>&lt;li&gt;</code> en cada elemento.'],
  htmlStructure:['Las etiquetas semánticas dan estructura y significado a la página.', 'Ejemplos: <code>&lt;header&gt;</code>, <code>&lt;main&gt;</code>, <code>&lt;section&gt;</code> y <code>&lt;footer&gt;</code>.'],
  htmlForms:    ['Los formularios recogen datos del usuario.', 'Se construyen con <code>&lt;form&gt;</code>, <code>&lt;input&gt;</code> y <code>&lt;button&gt;</code>.'],
  cssColor:     ['El CSS cambia la apariencia de la página.', 'Con <code>color</code> cambias el texto y con <code>background</code> el fondo.'],
  cssBox:       ['Cada elemento es una caja con margen, borde y relleno.', 'Ajusta el espacio con <code>margin</code>, <code>border</code> y <code>padding</code>.'],
  cssLayout:    ['El diseño moderno se arma con flexbox y grid.', '<code>display:flex</code> alinea elementos en fila o columna.'],
  cssFont:      ['La tipografía define el aspecto del texto.', 'Ajusta <code>font-size</code>, <code>font-weight</code> y <code>font-family</code>.'],
  generic:      ['Fíjate en el ejemplo y en cómo se escribe cada parte.', 'Después lo practicarás tú mismo.']
};

function detectTopic(code, lang, hint){
  const c = String(code||'');
  const L = String(lang||'').toLowerCase();
  const H = String(hint||'').toLowerCase();
  let t=null;
  if(c){
    if(L==='html'){
      if(/<h[1-6][\s>]/i.test(c)) t='htmlTitles';
      else if(/<a\s/i.test(c)) t='htmlLinks';
      else if(/<img\s/i.test(c)) t='htmlImages';
      else if(/<(ul|ol|li)[\s>]/i.test(c)) t='htmlLists';
      else if(/<form|<input|<button|<label/i.test(c)) t='htmlForms';
      else if(/<header|<main|<section|<footer|<nav|<article/i.test(c)) t='htmlStructure';
      else if(/<p[\s>]|<strong|<em/i.test(c)) t='htmlText';
    } else if(L==='css'){
      if(/display\s*:\s*(flex|grid)/i.test(c)) t='cssLayout';
      else if(/font-/i.test(c)) t='cssFont';
      else if(/margin|padding|border/i.test(c)) t='cssBox';
      else if(/color|background/i.test(c)) t='cssColor';
    } else if(L==='sql'){
      const u=c.toUpperCase();
      if(/\bSELECT\b/.test(u) && /\bJOIN\b/.test(u)) t='sqlJoin';
      else if(/\bINSERT\b/.test(u)) t='sqlInsert';
      else if(/\bUPDATE\b/.test(u)) t='sqlUpdate';
      else if(/\bDELETE\b/.test(u)) t='sqlDelete';
      else if(/\bWHERE\b/.test(u)) t='sqlWhere';
      else if(/\bSELECT\b/.test(u)) t='sqlSelect';
    } else {
      if(/\bclass\s+\w+/.test(c)) t='classes';
      else if(/\b(import|require)\b/.test(c)) t='modules';
      else if(/=>/.test(c)) t='arrow';
      else if(/\b(function|def)\s+\w+|function\s*\(/.test(c)) t='functions';
      else if(/\b(for|while)\b/.test(c)) t='loops';
      else if(/\bif\s*\(|\bif\s+.*:|\belse\b|\belif\b/.test(c)) t='conditionals';
      else if(/\bconsole\.log|\bprint\s*\(/.test(c)) t='print';
      else if(/\[\s*[^\]]*\s*\]|\.push\(|\.append\(/.test(c)) t='arrays';
      else if(/\b(const|let|var)\b|\b\w+\s*=\s*/.test(c)) t='variables';
    }
  }
  if(t) return t;
  if(/variable/.test(H)) return 'variables';
  if(/constante/.test(H)) return 'constants';
  if(/funci[oó]n|m[eé]todo/.test(H)) return 'functions';
  if(/bucle|ciclo|repet|recorr/.test(H)) return 'loops';
  if(/condici|decisi|\bif\b|\bsi\b/.test(H)) return 'conditionals';
  if(/arreglo|array|lista|colecci/.test(H)) return L==='html' ? 'htmlLists' : 'arrays';
  if(/objeto|propiedad/.test(H)) return 'objects';
  if(/texto|cadena|string/.test(H)) return 'strings';
  if(/n[uú]mero|operaci|matem|c[aá]lculo/.test(H)) return 'numbers';
  if(/clase/.test(H)) return 'classes';
  if(/m[oó]dulo|import|export/.test(H)) return 'modules';
  if(/color/.test(H)) return 'cssColor';
  if(/margen|padding|borde|espaci/.test(H)) return 'cssBox';
  if(/flex|grid|dise[nñ]o/.test(H)) return 'cssLayout';
  if(/fuente|tipograf/.test(H)) return 'cssFont';
  if(/t[ií]tulo|encabezado/.test(H)) return 'htmlTitles';
  if(/enlace|link/.test(H)) return 'htmlLinks';
  if(/imagen/.test(H)) return 'htmlImages';
  if(/formulario|input|bot[oó]n/.test(H)) return 'htmlForms';
  if(/select|consulta/.test(H)) return 'sqlSelect';
  if(/join|tabla/.test(H)) return 'sqlJoin';
  if(/insert|agregar/.test(H)) return 'sqlInsert';
  if(/update|actualiz/.test(H)) return 'sqlUpdate';
  if(/delete|borrar|eliminar/.test(H)) return 'sqlDelete';
  if(/where|filtrar/.test(H)) return 'sqlWhere';
  return 'generic';
}

function teachText(lines, code, lang, hint){
  const html = (lines||[]).join(' ');
  const topic = TOPIC_TEXT[detectTopic(code, lang, hint)] || TOPIC_TEXT.generic;
  const terms = keyTerms(html).filter(x=>x && x.length<=30).slice(0,3);
  let out = topic[0] + ' ' + topic[1];
  if(terms.length) out += ' Presta atención a ' + terms.map(x=>'<code>'+escapeHtml(x)+'</code>').join(', ') + '.';
  else if(!code) out += ' Lee con calma y continúa.';
  return out;
}

function buildBeats(tutorial){
  const beats=[];
  const lang = codeLangOf(tutorial.codeLanguage);
  const chapters = tutorial.chapters || [];
  for(const ch of chapters){
    for(const lesson of ch.lessons||[]){
      /* --- executableFiles --- */
      if(lesson.contentType==='executableFiles' && lesson.executableContent){
        const ex = lesson.executableContent;
        const file = (ex.files && (ex.files[ex.preselectedFileIndex||0] || ex.files[0])) || null;
        const instr = String(ex.instructions||'').replace(/`([^`]+)`/g,(m,c)=>'<code>'+escapeHtml(c)+'</code>');
        if(file){
          if(ex.hasVisualOutput){
            beats.push({k:'preview', prompt:'<b>Tu tarea:</b> '+instr, starter: sanitize(file.content)});
          } else {
            beats.push({k:'run', prompt:'<b>Tu tarea:</b> '+instr, lang: codeLangOf(file.codeLanguage), starter: sanitize(file.content)});
          }
        }
        continue;
      }
      /* --- interactive --- */
      const blocks = parseBlocks(lesson.interactiveContent||'');
      const hintBase = [tutorial.title, ch.title, lesson.title].filter(Boolean).join(' ');
      let pendingText=[], lastCode=null, lastTopicCode=null, lastBeat=null;
      const flushTeach=()=>{
        if(!pendingText.length && lastCode==null) return;
        const topicCode = lastCode!=null ? lastCode : lastTopicCode;
        const be={k:'teach', icon:'📘', text: teachText(pendingText, topicCode, lang, hintBase)};
        if(lastCode!=null){ be.code=lastCode; be.codeLang=lang; }
        beats.push(be); lastBeat=be; pendingText=[]; lastCode=null; lastTopicCode=null;
      };
      for(const b of blocks){
        if(b.t==='p'){
          if(b.wrong){ if(lastBeat) lastBeat.wrong='Revisa tu respuesta e inténtalo de nuevo.'; }
          else pendingText.push(b.text);
        } else if(b.t==='code'){
          lastTopicCode = b.codeStr;
          if(b.validated){
            flushTeach();
            const tok = b.validated.token;
            const be={k:'type', prompt:'Escribe el código que falta para completar el ejemplo.', code:withGap(b.codeStr,b.validated), answers:[tok], explain:'¡Correcto! <code>'+escapeHtml(tok)+'</code> es justo lo que faltaba.', wrong:'Casi. Revisa el ejemplo y vuelve a escribir la respuesta.'};
            beats.push(be); lastBeat=be;
          } else if(b.gaps.length){
            flushTeach();
            const toks=b.gaps.map(g=>g.token);
            const ex='¡Correcto! '+toks.map(t=>'<code>'+escapeHtml(t)+'</code>').join(', ')+(toks.length>1?' encajan':' encaja')+' a la perfección.';
            const be={k:'gap', prompt:(toks.length>1?'Completa los huecos para que el código funcione.':'Completa el hueco para que el código funcione.'), code:withGaps(b.codeStr,b.gaps), answers:toks, chips:b.distractors.slice(), explain:ex, wrong:'Algo no encaja. Revisa el código e inténtalo otra vez.'};
            beats.push(be); lastBeat=be;
          } else {
            lastCode = b.codeStr;
          }
        } else if(b.t==='selection'){
          const prompt = pendingText.length ? 'Elige la respuesta correcta:' : 'Elige la opción correcta.';
          pendingText=[];
          const be={k:'mcq', prompt, options:b.options, answer:b.answer, explain:'¡Correcto! Esa es la opción que cumple lo que pide el ejercicio.', wrong:'Esa no es la opción correcta. Vuelve a leer el enunciado.'};
          if(lastCode!=null){ be.code=lastCode; be.codeLang=lang; lastCode=null; }
          beats.push(be); lastBeat=be;
        } else if(b.t==='webview'){
          flushTeach();
          beats.push({k:'preview', prompt:'Prueba en vivo: edita el HTML y el CSS y observa el resultado.', starter:PREVIEW_TEMPLATE});
          lastBeat=beats[beats.length-1];
        }
      }
      flushTeach();
    }
  }
  return beats;
}

/* ------------------- pistas: iconos y colores ------------------- */
function trackStyle(name, id){
  const n = String(name||'').toLowerCase();
  if(/full-stack|fullstack/.test(n)) return {icon:'🧑‍💻', color:'#6366f1'};
  if(/python/.test(n)) return {icon:'🐍', color:'#22c55e'};
  if(/javascript/.test(n)) return {icon:'🌐', color:'#f59e0b'};
  if(/typescript/.test(n)) return {icon:'🔷', color:'#3b82f6'};
  if(/\bhtml\b/.test(n)) return {icon:'🧱', color:'#e34f26'};
  if(/\bcss\b/.test(n)) return {icon:'🎨', color:'#38bdf8'};
  if(/react/.test(n)) return {icon:'⚛️', color:'#61dafb'};
  if(/sql/.test(n)) return {icon:'🗄️', color:'#a78bfa'};
  if(/back-end|backend/.test(n)) return {icon:'🛠️', color:'#14b8a6'};
  if(/front-end|frontend/.test(n)) return {icon:'🖥️', color:'#f472b6'};
  if(/juego|game/.test(n)) return {icon:'🎮', color:'#ef4444'};
  if(/\bia\b|inteligencia/.test(n)) return {icon:'🤖', color:'#8b5cf6'};
  if(/swift|r[aá]pido/.test(n)) return {icon:'🍎', color:'#fb923c'};
  return {icon:'📚', color:'#94a3b8'};
}

/* ------------------- main ------------------- */
const MAX_BEATS = 25;
function chunkBeats(beats, max){
  if(beats.length <= max) return [beats];
  const n = Math.ceil(beats.length/max);
  const size = Math.ceil(beats.length/n);
  const out = [];
  for(let i=0;i<beats.length;i+=size) out.push(beats.slice(i,i+size));
  return out;
}
function main(){
  const tracksRaw = JSON.parse(fs.readFileSync(path.join(RAW,'tracks.json'),'utf8').replace(/^\uFEFF/,''));
  const indexTracks = [];
  const lessonMeta = {};       // id -> {t:title, h:homeTrack}
  const homeBeats = {};        // homeTrackId -> { lessonId: beats }
  let totalBeats=0, totalLessons=0, missing=0;
  const stats={teach:0,mcq:0,gap:0,type:0,preview:0,run:0};

  /* --- Pass 1: listado de pistas (ids unicos) --- */
  const trackList=[];
  for(const tr of tracksRaw.tracks){
    if(tr.id===271 || tr.id===272) continue;
    const ids=[]; const seen=new Set();
    for(const sec of (tr.sections||[])) for(const tid of (sec.tutorialIds||[])){
      if(seen.has(tid)) continue; seen.add(tid); ids.push('m'+tid);
    }
    if(!ids.length) continue;
    const st = trackStyle(tr.title, tr.id);
    trackList.push({id:String(tr.id), name:tr.title, icon:st.icon, color:st.color,
      desc:(tr.descriptionContent||'').replace(/<\/?[^>]+>/g,'').slice(0,70), ids, n:ids.length});
  }
  /* --- membership: leccion -> pistas que la incluyen --- */
  const members = {};
  for(const t of trackList) for(const id of t.ids){ (members[id]=members[id]||[]).push(t); }
  /* --- home = pista mas especifica (menos lecciones) --- */
  const homeOf = {};
  for(const id in members){
    let best=members[id][0];
    for(const t of members[id]) if(t.n < best.n) best=t;
    homeOf[id]=best.id;
  }

  /* --- Pass 2: construir beats una vez, dividir lecciones largas, guardar en la pista home --- */
  const built=new Set(), splitMap={};
  for(const t of trackList){
    for(const lessonId of t.ids){
      if(built.has(lessonId)) continue;
      built.add(lessonId);
      const tid = lessonId.slice(1);
      const file = path.join(RAW, 'tutorial-'+tid+'.json');
      if(!fs.existsSync(file)){ missing++; lessonMeta[lessonId]={t:'Lección '+tid, h:homeOf[lessonId]}; continue; }
      let tut; try{ tut=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')); }catch(e){ missing++; continue; }
      tut = tut.tutorial || tut;
      const beats = buildBeats(tut);
      const home = homeOf[lessonId];
      const base = tut.title || ('Lección '+tid);
      const chunks = chunkBeats(beats, MAX_BEATS);
      const subIds=[];
      chunks.forEach(function(chunk, p){
        const subId = p===0 ? lessonId : lessonId+'-'+(p+1);
        const title = chunks.length>1 ? base+' · '+(p+1)+'/'+chunks.length : base;
        subIds.push(subId);
        lessonMeta[subId] = {t:title, h:home};
        if(!homeBeats[home]) homeBeats[home]={};
        homeBeats[home][subId]=chunk;
        totalLessons++; totalBeats+=chunk.length;
        for(const b of chunk) stats[b.k]=(stats[b.k]||0)+1;
      });
      if(chunks.length>1) splitMap[lessonId]=subIds;
    }
  }
  /* reemplaza cada tutorial largo por sus partes, en el orden de cada pista */
  for(const t of trackList){
    const out=[];
    for(const id of t.ids){ if(splitMap[id]) out.push.apply(out, splitMap[id]); else out.push(id); }
    t.ids=out; t.n=out.length;
  }
  for(const t of trackList){ indexTracks.push({id:t.id, name:t.name, icon:t.icon, color:t.color, desc:t.desc, ids:t.ids, n:t.n}); }

  /* index.lessons solo con metadatos (sin beats) */
  const lessonsOut={};
  for(const id in lessonMeta){ lessonsOut[id]={t:lessonMeta[id].t, h:lessonMeta[id].h}; }

  fs.writeFileSync(path.join(OUT,'index.js'),
    'window.CR_INDEX='+JSON.stringify({v:1, tracks:indexTracks, lessons:lessonsOut})+';');
  for(const homeId in homeBeats){
    fs.writeFileSync(path.join(OUT,'track-'+homeId+'.js'),
      'window.CR_BEATS=Object.assign(window.CR_BEATS||{},'+JSON.stringify(homeBeats[homeId])+');');
  }

  console.log('Pistas:', indexTracks.length, '| Lecciones:', totalLessons, '| Beats:', totalBeats, '| faltantes:', missing);
  console.log('Tipos de beat:', JSON.stringify(stats));
  for(const t of indexTracks) console.log('  ', t.id, t.name, '->', t.n);
}
main();
