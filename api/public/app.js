/* Beemo Air · Portal de agencias */
(function(){
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>'US$'+Number(n||0).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtD=(d,o={weekday:'short',day:'numeric',month:'short'})=>new Intl.DateTimeFormat('es',o).format(new Date(d+'T12:00'));
const fmtDT=t=>new Intl.DateTimeFormat('es',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t));
const AIR={MIA:'Miami',AXM:'Armenia',BAQ:'Barranquilla'};
const ROUTES=[['MIA-AXM','Miami → Armenia'],['AXM-MIA','Armenia → Miami'],['MIA-BAQ','Miami → Barranquilla (Carnaval)'],['BAQ-MIA','Barranquilla → Miami (Carnaval)']];
const FARE={classic:'Classic',flex:'Flex',bc:'Flex BC'};
const FARE_INFO={classic:'Equipaje de mano · económica',flex:'Maleta 23 kg · cambio sin cargo',bc:'Business · 2 maletas'};
const ST={pending:'Pendiente de pago',confirmed:'Emitida',cancelled:'Anulada',expired:'Vencida'};
const ZP={1:25,2:30,3:15,4:8,5:0}, ROWS=26, BIZ=3, COLS=['A','B','C','D','E','F'], EXIT=[13,14];
const isSeat=(r,c)=>!(r<=BIZ&&(c==='B'||c==='E'));
const zoneOf=r=>r<=BIZ?0:r<=6?1:EXIT.includes(r)?2:r<=12?3:r<=22?4:5;
const seatPrice=(fare,id)=>{const z=zoneOf(parseInt(id));if(!z||fare==='bc')return 0;const p=ZP[z];return fare==='flex'?(z>=3?0:p-ZP[3]):p};
const app=$('#app');
let token=sessionStorage.getItem('beemo-agt')||'', me=null;
const BG='<div class="pbg" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>';
function getTheme(){try{const t=localStorage.getItem('beemo-theme');if(t==='dark'||t==='light')return t}catch(e){}return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}
function setTheme(t){document.body.classList.toggle('bd-dark',t==='dark');document.body.classList.toggle('bd-light',t==='light');try{localStorage.setItem('beemo-theme',t)}catch(e){}
  $$('[data-theme-btn]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeBtn===t)));window.dispatchEvent(new CustomEvent('beemo-theme',{detail:t}))}
const THEME_SW=()=>`<div class="tsw" role="group" aria-label="Modo de color"><button type="button" data-theme-btn="light" aria-label="Modo claro" title="Modo claro"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg></button><button type="button" data-theme-btn="dark" aria-label="Modo oscuro" title="Modo oscuro"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg></button></div>`;
function bindTheme(){$$('[data-theme-btn]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.themeBtn===getTheme()));b.onclick=()=>setTheme(b.dataset.themeBtn)})}
setTheme(getTheme());

async function api(path,opt={}){
  const r=await fetch('/api'+path,{method:opt.method||(opt.body?'POST':'GET'),headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:opt.body?JSON.stringify(opt.body):undefined});
  let j={}; try{j=await r.json()}catch(e){}
  if(r.status===401&&path!=='/auth/login'){token='';sessionStorage.removeItem('beemo-agt');me=null;boot();throw new Error(j.error||'Inicia sesión.')}
  if(!r.ok){const e=new Error(j.error||'No pudimos completar la solicitud.');e.data=j;e.status=r.status;throw e}
  return j;
}
const note=(el,msg,kind)=>{el.textContent=msg||'';el.className='note'+(kind?' '+kind:'');el.hidden=!msg};
function shell(tabs,cur,body){
  app.innerHTML=`<header class="top"><div class="wrap top-in"><a class="brand" href="/" aria-label="Beemo Air, portal de agencias"><svg class="wm" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><span>Agencias</span></a>
   <nav class="tabs" aria-label="Secciones">${tabs.map(([k,t])=>`<a href="#${k}" ${k===cur?'aria-current="page"':''}>${t}</a>`).join('')}</nav>
   <div class="who">${THEME_SW()}<span><b>${esc(me.agency?me.agency.name:'Beemo Air')}${me.agency&&me.agency.country?' · '+esc(me.agency.country):''}</b>${esc(me.name||me.email)}</span><button class="btn ghost sm" id="out">Salir</button></div></div></header>
   <main class="wrap main" id="main">${body}</main>${BG}`;
  bindTheme();
  $('#out').onclick=async()=>{try{await api('/auth/logout',{body:{}})}catch(e){} token='';sessionStorage.removeItem('beemo-agt');me=null;location.hash='';boot()};
}

/* ---------- login / setup / password ---------- */
async function viewLogin(){
  let setup=false; try{setup=(await api('/admin/setup')).needed}catch(e){}
  app.innerHTML=`${BG}<div class="login"><div class="login-top">${THEME_SW()}</div><div class="login-card">
   <svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg>
   <h1>Portal de agencias</h1><p class="muted">Reserva y emite vuelos de Beemo Air para tus clientes, con el mismo inventario de beemoair.com.</p>
   ${setup?`<form id="setupF" class="stack"><h2>Configura la cuenta de administrador</h2><label>Código de configuración<input name="code" autocomplete="off" required></label><label>Nombre<input name="name" autocomplete="name"></label><label>Correo<input name="email" type="email" autocomplete="email" required></label><label>Contraseña (mínimo 10 caracteres)<input name="password" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Crear administrador</button></form><hr>`:''}
   <form id="loginF" class="stack"><label>Correo<input name="email" type="email" autocomplete="username" required></label><label>Contraseña<input name="password" type="password" autocomplete="current-password" required></label><p class="note" hidden></p><button class="btn lime">Entrar</button></form>
   <p class="fine">¿Tu agencia aún no tiene acceso? Escríbenos a <a href="mailto:management@beemoair.com">management@beemoair.com</a>.</p></div></div>`;
  bindTheme(); const lf=$('#loginF');
  lf.onsubmit=async e=>{e.preventDefault();const n=$('.note',lf);note(n,'');const d=Object.fromEntries(new FormData(lf));
    try{const r=await api('/auth/login',{body:d});token=r.token;sessionStorage.setItem('beemo-agt',token);me=r.user;boot()}catch(err){note(n,err.message,'err')}};
  const sf=$('#setupF'); if(sf) sf.onsubmit=async e=>{e.preventDefault();const n=$('.note',sf);const d=Object.fromEntries(new FormData(sf));
    try{await api('/admin/setup',{body:d});note(n,'Listo. Ya puedes entrar con ese correo y contraseña.','ok');sf.querySelector('button').disabled=true;lf.email.value=d.email}catch(err){note(n,err.message,'err')}};
}
function viewPassword(){
  app.innerHTML=`${BG}<div class="login"><div class="login-top">${THEME_SW()}</div><div class="login-card"><svg class="wm big" role="img" aria-label="Beemo Air"><use href="#wm"/></svg><h1>Crea tu contraseña</h1><p class="muted">Entraste con una contraseña temporal. Elige una nueva de al menos 10 caracteres.</p>
   <form id="pwF" class="stack"><label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" required minlength="10"></label><label>Repítela<input name="again" type="password" autocomplete="new-password" required></label><p class="note" hidden></p><button class="btn lime">Guardar y continuar</button></form></div></div>`;
  bindTheme(); const f=$('#pwF');f.onsubmit=async e=>{e.preventDefault();const n=$('.note',f);if(f.password.value!==f.again.value)return note(n,'Las contraseñas no coinciden.','err');
    try{await api('/me/password',{body:{password:f.password.value}});me.must_change=false;boot()}catch(err){note(n,err.message,'err')}};
}

/* ---------- seat map ---------- */
function seatMap({fare,taken,mine,activePax,readOnly,names}){
  let h=`<div class="cabin" role="grid" aria-label="Mapa de asientos"><div class="row cols"><span>A</span><span>B</span><span>C</span><span></span><span>D</span><span>E</span><span>F</span></div>`;
  for(let r=1;r<=ROWS;r++){const z=zoneOf(r);h+=`<div class="row${r===BIZ+1?' gap':''}${EXIT.includes(r)?' exit':''}" role="row">`;
    COLS.forEach((c,ci)=>{if(ci===3)h+=`<span class="rn">${r}</span>`;if(!isSeat(r,c)){h+='<span></span>';return}
      const id=r+c, own=mine?mine.indexOf(id):-1, tk=taken.has(id)&&own<0, wrong=fare&&(fare==='bc'?r>BIZ:r<=BIZ);
      const cls=['seat',readOnly?'ro':'',r<=BIZ?'biz':'z'+z,own===activePax?'mine':own>=0?'other':'',wrong&&own<0?'blocked':''].join(' ');
      const lbl=`Asiento ${id}${tk?', ocupado':wrong?', otra cabina':own>=0?`, pasajero ${own+1}`:', libre'}${fare&&!tk&&!wrong?' · '+(seatPrice(fare,id)?'US$'+seatPrice(fare,id):'sin costo'):''}${names&&names[id]?' · '+names[id]:''}`;
      h+=`<button type="button" class="${cls}${tk&&readOnly?' sold':''}" data-seat="${id}" ${tk&&!readOnly||readOnly?'':''} ${readOnly?'tabindex="-1" aria-disabled="true"':(tk||wrong?'disabled':'')} title="${esc(lbl)}" aria-label="${esc(lbl)}">${own>=0?own+1:''}</button>`});
    h+='</div>'}
  return h+'</div>';
}

/* ---------- agent: new booking ---------- */
let NB=null;
function resetNB(){NB={route:'MIA-AXM',trip:'ow',pax:1,legs:[],sel:[],paxd:[],contact:{email:'',phone:''},seats:[],extras:[],pay:'cash',activeLeg:0,activePax:0}}
function viewNew(){
  if(!NB) resetNB();
  shell(agentTabs,'nueva',`<section class="card"><h1>Nueva reserva</h1>
   <form id="srch" class="srch"><label>Ruta<select name="route">${ROUTES.map(([k,t])=>`<option value="${k}" ${k===NB.route?'selected':''}>${t}</option>`).join('')}</select></label>
   <label>Viaje<select name="trip"><option value="ow" ${NB.trip==='ow'?'selected':''}>Solo ida</option><option value="rt" ${NB.trip==='rt'?'selected':''}>Ida y vuelta</option></select></label>
   <label>Pasajeros<select name="pax">${[1,2,3,4,5,6,7,8,9].map(n=>`<option ${n===NB.pax?'selected':''}>${n}</option>`).join('')}</select></label>
   <label>Desde<input type="date" name="from" value="${NB.from||new Date().toISOString().slice(0,10)}"></label>
   <button class="btn lime">Buscar vuelos</button></form><p class="note" id="srchN" hidden></p></section>
   <div id="nb"></div>`);
  const f=$('#srch');
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));const n=$('#srchN');note(n,'');
    NB.route=d.route;NB.trip=d.trip;NB.pax=+d.pax;NB.from=d.from;
    const [o,dd]=d.route.split('-'), routes=[d.route].concat(d.trip==='rt'?[dd+'-'+o]:[]);
    try{NB.legs=await Promise.all(routes.map(r=>api(`/agency/flights?route=${r}&from=${d.from}&n=10`)));NB.routes=routes;}catch(err){return note(n,err.message,'err')}
    if(NB.legs.some(l=>!l.length)) return note(n,'No hay vuelos para esa ruta desde la fecha elegida.','err');
    NB.sel=routes.map(()=>({date:null,fare:null}));NB.paxd=Array.from({length:NB.pax},(_,i)=>NB.paxd[i]||{first:'',last:'',inf:false});
    NB.seats=routes.map(()=>[]);NB.extras=routes.map(()=>[]);NB.taken=routes.map(()=>new Set());NB.activeLeg=0;NB.activePax=0;NB.done=null;
    renderNB()};
  if(NB.legs.length) renderNB();
}
function renderNB(){
  const box=$('#nb'); if(!box) return;
  const ready=NB.sel.length&&NB.sel.every(s=>s.date&&s.fare);
  let h=NB.routes.map((r,li)=>{const [o,d]=r.split('-');return `<section class="card"><h2>${li?'Vuelta':'Ida'}: ${AIR[o]} → ${AIR[d]}</h2><div class="flights">`+
    NB.legs[li].filter(f=>!NB.sel[li].fare||NB.sel[li].date===f.date).map(f=>{const seats=f.avail.eco+f.avail.biz;return `<div class="fl ${NB.sel[li].date===f.date?'on':''}"><div class="fl-h"><b>${fmtD(f.date,{weekday:'long',day:'numeric',month:'long'})}</b><span>${f.no} · ${f.dep}–${f.arr}</span><span class="avail ${seats<20?'low':''}">${fxMini(seats/150,'')} ${seats} sillas libres · ${f.avail.biz} en Business</span></div>
      ${NB.sel[li].fare?`<button type="button" class="btn ghost sm chg" data-chgleg="${li}">Cambiar vuelo</button>`:''}<div class="fares">${['classic','flex','bc'].map(k=>{const soldOut=k==='bc'?f.avail.biz<NB.pax:f.avail.eco<NB.pax;return `<button type="button" class="fare" data-leg="${li}" data-date="${f.date}" data-fare="${k}" aria-pressed="${NB.sel[li].date===f.date&&NB.sel[li].fare===k}" ${soldOut?'disabled':''}><b>${FARE[k]}</b><span>${soldOut?'Agotado':money(f.prices[k])}</span><small>${FARE_INFO[k]}</small></button>`}).join('')}</div></div>`}).join('')+`</div></section>`}).join('');
  if(ready){
    h+=`<section class="card"><h2>Pasajeros</h2><p class="muted">Nombres tal como aparecen en el pasaporte.</p><div class="pax">`+NB.paxd.map((p,i)=>`<div class="paxrow"><span class="pn">${i+1}</span><label>Nombre<input data-p="${i}" data-k="first" value="${esc(p.first)}"></label><label>Apellido<input data-p="${i}" data-k="last" value="${esc(p.last)}"></label><label class="chk"><input type="checkbox" data-p="${i}" data-k="inf" ${p.inf?'checked':''}> Bebé en brazos (US$40 por trayecto)</label></div>`).join('')+
      `</div><div class="grid2"><label>Correo del cliente<input type="email" id="cEmail" value="${esc(NB.contact.email)}"></label><label>Teléfono del cliente<input id="cPhone" value="${esc(NB.contact.phone)}"></label></div></section>`;
    // seats
    const li=NB.activeLeg, s=NB.sel[li];
    h+=`<section class="card"><h2>Asientos <small>opcional</small></h2><p class="muted">Si no eliges, el sistema asigna una silla sin costo. Elige un pasajero y toca una silla libre.</p>
     ${NB.routes.length>1?`<div class="seg">${NB.routes.map((r,i)=>`<button type="button" data-legtab="${i}" aria-pressed="${i===li}">${i?'Vuelta':'Ida'} ${r.replace('-',' → ')}</button>`).join('')}</div>`:''}
     <div class="seatwrap"><div><ul class="plist">${NB.paxd.map((p,i)=>`<li><button type="button" data-ap="${i}" aria-pressed="${i===NB.activePax}"><span>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</span><b>${NB.seats[li][i]||'—'}</b>${NB.seats[li][i]?`<small>${seatPrice(s.fare,NB.seats[li][i])?money(seatPrice(s.fare,NB.seats[li][i])):'sin costo'}</small>`:''}</button></li>`).join('')}</ul>
     <ul class="zones"><li><i class="z1"></i>Preferente 4–6 · US$25</li><li><i class="z2"></i>Salida 13–14 · US$30</li><li><i class="z3"></i>Delantera 7–12 · US$15</li><li><i class="z4"></i>Central 15–22 · US$8</li><li><i class="z5"></i>Trasera 23–26 · sin costo</li></ul><p class="fine">Flex incluye delantera y central; en preferente y salida paga la diferencia. Flex BC: Business incluido.</p></div>
     <div id="smap">${seatMap({fare:s.fare,taken:NB.taken[li],mine:NB.seats[li],activePax:NB.activePax})}</div></div></section>`;
    // extras
    h+=`<section class="card"><h2>Extras</h2><div class="xt"><table><thead><tr><th>Pasajero</th>${NB.routes.map((r,i)=>`<th colspan="3">${i?'Vuelta':'Ida'} · ${FARE[NB.sel[i].fare]}</th>`).join('')}</tr><tr><th></th>${NB.routes.map(()=>'<th>Maleta 23 kg<br><small>US$35</small></th><th>2.ª maleta<br><small>US$55</small></th><th>Prioritario<br><small>US$8</small></th>').join('')}</tr></thead><tbody>`+
      NB.paxd.map((p,i)=>`<tr><td>${esc(p.first||'Pasajero')} ${esc(p.last||i+1)}</td>${NB.routes.map((r,l)=>{const f=NB.sel[l].fare,x=NB.extras[l][i]||{};
        const cell=(k,st)=>`<td>${st==='inc'?'<span class="inc">Incluido</span>':st==='off'?'<span class="muted">—</span>':`<input type="checkbox" data-x="${k}" data-l="${l}" data-i="${i}" ${x[k]?'checked':''} aria-label="${k} pasajero ${i+1}">`}</td>`;
        return cell('bag',f!=='classic'?'inc':'opt')+cell('bag2',f==='bc'?'inc':f==='classic'&&!x.bag?'off':'opt')+cell('prio',f==='bc'?'inc':'opt')}).join('')}</tr>`).join('')+`</tbody></table></div></section>`;
    h+=`<section class="card"><h2>Pago</h2><div class="pay"><label class="opt"><input type="radio" name="pay" value="cash" ${NB.pay==='cash'?'checked':''}><span><b>Cobro en agencia</b><small>Tu agencia cobra al cliente. La reserva se emite de inmediato y el valor queda en tu saldo por consignar a Beemo Air cada semana.</small></span></label>
     <label class="opt"><input type="radio" name="pay" value="card" ${NB.pay==='card'?'checked':''}><span><b>Tarjeta del cliente</b><small>Se genera un enlace de pago seguro. Las sillas quedan apartadas hasta que se pague.</small></span></label></div>
     <div id="qbox" class="qbox"></div><p class="note" id="bookN" hidden></p><button class="btn lime big" id="bookBtn">Confirmar reserva</button></section>`;
  }
  box.innerHTML=h;
  $$('.fare',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.leg;const prev=NB.sel[li].date;NB.sel[li]={date:b.dataset.date,fare:b.dataset.fare};if(prev!==b.dataset.date||true){NB.seats[li]=[];NB.extras[li]=[]}
    const next=d=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+1);return x.toISOString().slice(0,10)};
    const more=li===0&&NB.routes.length>1?api(`/agency/flights?route=${NB.routes[1]}&from=${next(NB.sel[0].date)}&n=10`).then(r=>{NB.legs[1]=r;if(NB.sel[1].date&&NB.sel[1].date<=NB.sel[0].date){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}}).catch(()=>{}):Promise.resolve();
    Promise.all([loadTaken(li),more]).then(()=>{keep(renderNB);quote()})});
  $$('[data-chgleg]',box).forEach(b=>b.onclick=()=>{const li=+b.dataset.chgleg;NB.sel[li]={date:null,fare:null};NB.seats[li]=[];NB.extras[li]=[];if(li===0&&NB.sel[1]){NB.sel[1]={date:null,fare:null};NB.seats[1]=[];NB.extras[1]=[]}renderNB()});
  if(!ready) return;
  $$('[data-p]',box).forEach(x=>x.oninput=x.onchange=()=>{const p=NB.paxd[+x.dataset.p];if(x.type==='checkbox'){p.inf=x.checked;quote()}else{p[x.dataset.k]=x.value.trim()}});
  $('#cEmail').oninput=e=>NB.contact.email=e.target.value.trim(); $('#cPhone').oninput=e=>NB.contact.phone=e.target.value.trim();
  $$('[data-legtab]',box).forEach(b=>b.onclick=()=>{NB.activeLeg=+b.dataset.legtab;keep(renderNB)});
  $$('[data-ap]',box).forEach(b=>b.onclick=()=>{NB.activePax=+b.dataset.ap;keep(renderNB)});
  $$('#smap [data-seat]',box).forEach(b=>b.onclick=()=>{const li=NB.activeLeg,m=NB.seats[li],id=b.dataset.seat,ow=m.indexOf(id);if(ow>=0&&ow!==NB.activePax)return;
    m[NB.activePax]=ow===NB.activePax?undefined:id; if(m[NB.activePax]&&NB.activePax<NB.pax-1&&!m[NB.activePax+1])NB.activePax++; keep(renderNB); quote()});
  $$('[data-x]',box).forEach(c=>c.onchange=()=>{const l=+c.dataset.l,i=+c.dataset.i,x=NB.extras[l][i]=NB.extras[l][i]||{};x[c.dataset.x]=c.checked;if(c.dataset.x==='bag'&&!c.checked)x.bag2=false;keep(renderNB);quote()});
  $$('[name=pay]',box).forEach(r=>r.onchange=()=>{NB.pay=r.value});
  $('#bookBtn').onclick=book;
  quote();
}
function keep(fn){const y=scrollY;fn();scrollTo(0,y)}
async function loadTaken(li){const s=NB.sel[li];try{const r=await api(`/seats?route=${NB.routes[li]}&date=${s.date}`);NB.taken[li]=new Set(r.taken)}catch(e){NB.taken[li]=new Set()}}
function payload(){return{legs:NB.routes.map((r,i)=>({route:r,date:NB.sel[i].date,fare:NB.sel[i].fare,seats:NB.paxd.map((_,p)=>NB.seats[i][p]||null),extras:NB.paxd.map((_,p)=>NB.extras[i][p]||{})})),
  pax:NB.paxd.map(p=>({first:p.first||'X',last:p.last||'X',inf:p.inf})),contact:{email:NB.contact.email||'cotizacion@beemoair.com',phone:NB.contact.phone},pay:NB.pay}}
let qt=0;
async function quote(){const box=$('#qbox');if(!box)return;const my=++qt;
  try{const b=await api('/agency/quote',{body:payload()});if(my!==qt)return;
    box.innerHTML=`<table class="sum"><tr><td>Tarifas (${NB.pax} ${NB.pax>1?'pasajeros':'pasajero'}, impuestos incluidos)</td><td>${money(b.fares)}</td></tr>${b.seats?`<tr><td>Asientos</td><td>${money(b.seats)}</td></tr>`:''}${b.extras?`<tr><td>Extras</td><td>${money(b.extras)}</td></tr>`:''}${b.infants?`<tr><td>Bebés en brazos</td><td>${money(b.infants)}</td></tr>`:''}<tr class="tot"><td>Total a cobrar al cliente</td><td>${money(b.total)}</td></tr><tr class="com"><td>Tu comisión (${b.rate} % de la tarifa neta)</td><td>${money(b.commission)}</td></tr></table>`}
  catch(e){if(my===qt)box.innerHTML=`<p class="muted">${esc(e.message)}</p>`}}
async function book(){
  const n=$('#bookN');note(n,'');
  const miss=NB.paxd.findIndex(p=>!p.first||!p.last); if(miss>=0) return note(n,`Falta el nombre o el apellido del pasajero ${miss+1}.`,'err');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(NB.contact.email)) return note(n,'Escribe el correo del cliente: ahí recibe su reserva.','err');
  const btn=$('#bookBtn');btn.disabled=true;btn.textContent='Reservando…';
  try{const r=await api('/agency/bookings',{body:payload()});NB.done=r;showDone(r);resetNB()}
  catch(e){note(n,e.message,'err');btn.disabled=false;btn.textContent='Confirmar reserva';
    if(e.data&&e.data.code==='seat_taken'){await Promise.all(NB.routes.map((_,i)=>loadTaken(i)));NB.routes.forEach((_,i)=>NB.seats[i]=NB.seats[i].map(s=>s&&NB.taken[i].has(s)?undefined:s));keep(renderNB);note($('#bookN'),e.message,'err')}}
}
function showDone(r){
  $('#main').innerHTML=`<section class="card done"><p class="kick">${r.status==='confirmed'?'Reserva emitida':'Reserva creada · pendiente de pago'}</p><p class="pnr">${r.pnr}</p>
   ${legsTable(r)}${r.status==='pending'?`<p>Las sillas quedan apartadas hasta el <b>${fmtDT(r.expires)}</b>. ${r.pay_url?'Envía este enlace de pago al cliente:':'La pasarela de pago aún no está activa: Beemo Air confirmará el pago manualmente.'}</p>${r.pay_url?`<div class="link"><input readonly value="${esc(r.pay_url)}"><button class="btn ghost sm" id="cp">Copiar</button></div>`:''}`:
   `<p>Total cobrado por tu agencia: <b>${money(r.total)}</b>. Queda en tu saldo por consignar.</p>`}
   <p class="muted">Tu comisión: ${money(r.commission)}.</p><div class="acts"><button class="btn lime" id="again">Nueva reserva</button><a class="btn ghost" href="#reservas">Ver mis reservas</a></div></section>`;
  $('#again').onclick=()=>viewNew(); const cp=$('#cp'); if(cp) cp.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(r.pay_url);cp.textContent='Copiado'};
}
function legsTable(b){return `<table class="sum">${b.legs.map(l=>`<tr><td><b>${l.route.replace('-',' → ')}</b> · ${l.no}<br><span class="muted">${fmtD(l.date,{weekday:'long',day:'numeric',month:'long'})} · ${l.dep}–${l.arr} · ${FARE[l.fare]}</span></td><td>${l.seats.join(', ')}</td></tr>`).join('')}
  <tr><td colspan="2" class="muted">${b.pax.map(p=>esc(p.first+' '+p.last)+(p.inf?' (+ bebé)':'')).join(' · ')}</td></tr></table>`}

/* ---------- agent: bookings & statement ---------- */
async function viewBookings(){
  shell(agentTabs,'reservas',`<section class="card"><h1>Mis reservas</h1><div id="bl"><p class="muted">Cargando…</p></div></section>`);
  const list=await api('/agency/bookings'); const bl=$('#bl');
  if(!list.length){bl.innerHTML='<p class="muted">Aún no tienes reservas. <a href="#nueva">Crea la primera</a>.</p>';return}
  const byS=k=>list.filter(b=>b.status===k), ok=byS('confirmed');
  bl.innerHTML=`<div class="fx-grid rs"><div class="fx-cell">${fxDonut([{v:ok.length,cls:'c1',label:'Emitidas'},{v:byS('pending').length,cls:'c2',label:'Pendientes de pago'},{v:byS('cancelled').length+byS('expired').length,cls:'c3',label:'Anuladas o vencidas'}],fxCount(list.length),list.length===1?'reserva':'reservas')}</div>
   <ul class="fx-stats"><li>${fxCount(ok.reduce((t,b)=>t+b.pax.length,0))}<span>pasajeros emitidos</span></li><li>${fxCount(ok.reduce((t,b)=>t+b.total,0),'money')}<span>vendido</span></li><li>${fxCount(ok.reduce((t,b)=>t+b.commission,0),'money')}<span>tu comisión</span></li></ul></div>
  <div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Comisión</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(b=>`<tr>
   <td><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td>${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}`).join('<br>')}</td><td>${b.pax.length}</td><td>${money(b.total)}</td><td>${money(b.commission)}</td>
   <td>${b.pay_method==='cash'?(b.settled?'Agencia · consignado':'Agencia · por consignar'):'Tarjeta'}</td><td><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td>${b.status==='pending'?`${b.pay_url?`<button class="btn ghost sm" data-cp="${esc(b.pay_url)}">Enlace</button> `:''}<button class="btn ghost sm" data-cancel="${b.pnr}">Anular</button>`:''}</td></tr>`).join('')}</tbody></table></div>`;
  $$('[data-cancel]',bl).forEach(b=>b.onclick=async()=>{if(!confirm(`¿Anular la reserva ${b.dataset.cancel}? Las sillas se liberan.`))return;try{await api(`/agency/bookings/${b.dataset.cancel}/cancel`,{body:{}});viewBookings()}catch(e){alert(e.message)}});
  $$('[data-cp]',bl).forEach(b=>b.onclick=()=>{navigator.clipboard&&navigator.clipboard.writeText(b.dataset.cp);b.textContent='Copiado'});
}
async function viewStatement(){
  shell(agentTabs,'cuenta',`<section class="card"><h1>Estado de cuenta</h1><div id="stm"><p class="muted">Cargando…</p></div></section>`);
  const s=await api('/agency/statement');
  const cash=(s.cash_settled||0)+s.cash_due;
  $('#stm').innerHTML=`<div class="fx-grid rs"><div class="fx-cell">${fxGauge({p:cash?(s.cash_settled||0)/cash:1,val:cash?fxCount((s.cash_settled||0)/cash*100,'pct'):'<b>Al día</b>',label:'efectivo consignado',sub:cash?`${money(s.cash_settled||0)} de ${money(cash)}`:'no tienes efectivo por consignar'})}</div>
   <div class="fx-cell">${fxDonut([{v:s.net-s.commission>0?s.net-s.commission:0,cls:'c3',label:'Tarifa neta para Beemo Air',txt:money(Math.max(0,s.net-s.commission))},{v:s.commission,cls:'c1',label:'Tu comisión',txt:money(s.commission)},{v:Math.max(0,s.sales-s.net),cls:'c2',label:'Impuestos, tasas y extras',txt:money(Math.max(0,s.sales-s.net))}],fxCount(s.sales,'usd'),'ventas totales')}</div></div>
   <ul class="kpis"><li>${fxCount(s.bookings)}<span>reservas emitidas</span></li><li>${fxCount(s.sales,'money')}<span>ventas totales</span></li><li>${fxCount(s.commission,'money')}<span>comisión causada (${me.agency.commission+me.agency.incentive} %)</span></li><li class="due">${fxCount(s.cash_due,'money')}<span>por consignar a Beemo Air</span></li></ul>
   <p class="muted">La comisión es del ${me.agency.commission} % de la tarifa neta${me.agency.incentive?` más un incentivo del ${me.agency.incentive} %`:''}, sin impuestos, tasas ni extras. Se liquida cada mes. Lo cobrado en efectivo se consigna cada semana, a más tardar el segundo día hábil de la semana siguiente.</p>
   ${s.pending?`<p>Tienes ${s.pending} ${s.pending>1?'reservas pendientes':'reserva pendiente'} de pago.</p>`:''}`;
}
const agentTabs=[['nueva','Nueva reserva'],['reservas','Mis reservas'],['cuenta','Estado de cuenta']];

/* ---------- FX: indicadores animados (medidor, píldoras, anillo, conteo) ---------- */
const RM=matchMedia('(prefers-reduced-motion: reduce)').matches;
const fxFmt=(v,f)=>f==='money'?money(v):f==='usd'?usd0(v):f==='pct'?Math.round(v)+' %':Math.round(v).toLocaleString('es-CO');
function fxCount(v,f='int'){v=+v||0;return `<b class="fx-n fx-wait" data-n="${v}" data-f="${f}">${fxFmt(RM?v:0,f)}</b>`}
const fxPolar=(r,a)=>{const t=a*Math.PI/180;return [(100+r*Math.cos(t)).toFixed(2),(100+r*Math.sin(t)).toFixed(2)]};
// medidor tipo termostato: arco de 270°, marcas, perilla y meta opcional
function fxGauge({p,val,label,sub,mark,markLabel,small}){
  p=Math.max(0,Math.min(1,+p||0));const A0=135,SW=270,R=76;
  const [x0,y0]=fxPolar(R,A0),[x1,y1]=fxPolar(R,A0+SW),arc=`M${x0} ${y0}A${R} ${R} 0 1 1 ${x1} ${y1}`;
  let t='';const N=40;for(let i=0;i<=N;i++){const a=A0+SW*i/N,[a1,b1]=fxPolar(97,a),[a2,b2]=fxPolar(i%5===0?89:92,a);t+=`<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" class="fx-t${p>0&&i/N<=p+.001?' on':''}" style="--i:${i}"/>`}
  let mk='';if(mark!=null){const a=A0+SW*mark,[m1,n1]=fxPolar(62,a),[m2,n2]=fxPolar(86,a);mk=`<line x1="${m1}" y1="${n1}" x2="${m2}" y2="${n2}" class="fx-mk"/>`}
  const [kx,ky]=fxPolar(R,A0);
  return `<div class="fx-gw${small?' sm':''}"><figure class="fx-g fx-wait${small?' sm':''}"><svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="fxgr" x1="0" y1="1" x2="1" y2="0"><stop offset="0" class="fx-s0"/><stop offset="1" class="fx-s1"/></linearGradient></defs>
   ${t}<path d="${arc}" class="fx-tr" pathLength="100"/><path d="${arc}" class="fx-pr" pathLength="100" style="--o:${(100-p*100).toFixed(2)}"/>${mk}
   <g class="fx-kn" style="--r:${(p*SW).toFixed(1)}deg"><circle cx="${kx}" cy="${ky}" r="12" class="fx-kb"/><circle cx="${kx}" cy="${ky}" r="4.5" class="fx-kd"/></g></svg>
   <figcaption class="fx-gc">${val}<span>${label}</span></figcaption></figure>${sub||markLabel?`<p class="fx-gs">${sub||''}${mark!=null&&markLabel?`<span class="fx-ml"><i></i>${markLabel}</span>`:''}</p>`:''}</div>`}
// columnas en píldora (como «Próximas operaciones»)
function fxPills(items,{H=170,refs=[]}={}){
  if(!items.length) return '<p class="muted">Sin datos todavía.</p>';
  return `<div class="fx-pills fx-wait">${refs.map(r=>`<div class="fx-ref${r.crit?' crit':''}" style="bottom:${28+r.v*H}px"><span>${r.label}</span></div>`).join('')}
   ${items.map((it,i)=>{const p=Math.max(0,Math.min(1,it.p||0)),h=p>0?Math.max(40,p*H):0,hh=it.held?Math.min(H,h+it.held*H):0;
    return `<div class="fx-pill${it.on?' on':''}" tabindex="0" ${it.tip?`data-tip="${esc(it.tip)}"`:''} aria-label="${esc(it.aria||it.label)}" style="--d:${i*55}ms"><span class="fx-pt" style="height:${H}px">${hh?`<span class="fx-ph" style="height:${hh}px"></span>`:''}<span class="fx-pf" style="height:${h}px">${h>=64&&it.txt?`<em>${it.txt}</em>`:''}</span></span><span class="fx-px">${it.label}</span></div>`}).join('')}</div>`}
// anillo por segmentos con leyenda
function fxDonut(segs,center,label){
  const tot=segs.reduce((s,x)=>s+(x.v||0),0),live=segs.filter(s=>s.v>0).length,gap=live>1?1.4:0;let acc=0;
  const arcs=tot?segs.map((s,i)=>{if(!s.v)return'';const len=Math.max(.4,s.v/tot*100-gap),o=acc;acc+=s.v/tot*100;
    return `<circle cx="80" cy="80" r="64" pathLength="100" class="fx-ds ${s.cls}" style="--a:${len.toFixed(2)};--o:${(-o).toFixed(2)};--d:${i*140}ms"/>`}).join(''):'';
  return `<div class="fx-dn fx-wait"><div class="fx-dr"><svg viewBox="0 0 160 160" aria-hidden="true"><circle cx="80" cy="80" r="64" class="fx-dt"/>${arcs}</svg><div class="fx-dc">${center}<span>${label}</span></div></div>
   <ul class="fx-lg">${segs.map(s=>`<li><i class="${s.cls}"></i><span>${s.label}</span><b>${s.txt??s.v}</b></li>`).join('')}</ul></div>`}
// anillo pequeño para tablas
function fxMini(p,txt){p=Math.max(0,Math.min(1,+p||0));return `<span class="fx-mini fx-wait"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="14" class="fx-mt"/><circle cx="18" cy="18" r="14" pathLength="100" class="fx-mp" style="--o:${(100-p*100).toFixed(2)}"/></svg><span>${txt}</span></span>`}
// barras horizontales animadas
function fxBars(rows,fmt='money'){const max=Math.max(...rows.map(r=>r.v),1);return `<ul class="fx-bars fx-wait">${rows.map((r,i)=>`<li style="--d:${i*80}ms"><span>${esc(r.n)}</span><span class="fx-bt"><i style="width:${r.v/max*100}%"></i></span><b>${fxFmt(r.v,fmt)}</b></li>`).join('')}</ul>`}
function fxRun(el){el.classList.remove('fx-wait');const run=n=>{if(n.dataset.done)return;n.dataset.done=1;const to=+n.dataset.n,f=n.dataset.f;if(RM||!to){n.textContent=fxFmt(to,f);return}
  const t0=performance.now(),D=1100,step=t=>{const k=Math.min(1,(t-t0)/D),e=1-Math.pow(1-k,3);n.textContent=fxFmt(to*e,f);if(k<1)requestAnimationFrame(step)};requestAnimationFrame(step)};
  if(el.matches('.fx-n'))run(el);$$('.fx-n',el).forEach(n=>{n.classList.remove('fx-wait');run(n)})}
const fxIO=!RM&&'IntersectionObserver' in window?new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){fxIO.unobserve(e.target);fxRun(e.target)}}),{threshold:.05}):null;
let fxTipEl=null;
function fxScan(){$$('.fx-wait').forEach(el=>{if(el.dataset.fxo)return;el.dataset.fxo=1;fxIO?fxIO.observe(el):fxRun(el)});
  $$('[data-tip]:not([data-tb])').forEach(el=>{if(el.closest('#dash'))return;el.dataset.tb=1;
    if(!fxTipEl){fxTipEl=document.createElement('div');fxTipEl.className='dtip fx-tip';fxTipEl.setAttribute('role','tooltip');fxTipEl.hidden=true;document.body.appendChild(fxTipEl)}
    const show=()=>{fxTipEl.innerHTML=el.dataset.tip;fxTipEl.hidden=false;const r=el.getBoundingClientRect(),w=fxTipEl.offsetWidth;fxTipEl.style.left=Math.min(innerWidth-w-8,Math.max(8,r.left+r.width/2-w/2))+'px';fxTipEl.style.top=(r.top+scrollY-fxTipEl.offsetHeight-10)+'px'};
    const hide=()=>fxTipEl.hidden=true;el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',hide);el.addEventListener('blur',hide)})}
let fxQ=0;new MutationObserver(()=>{if(fxQ)return;fxQ=requestAnimationFrame(()=>{fxQ=0;fxScan()})}).observe(document.getElementById('app')||document.body,{childList:true,subtree:true});
const dayKey=d=>new Date(d).toLocaleDateString('en-CA',{timeZone:'America/New_York'});
function lastDays(n){const out=[];for(let i=n-1;i>=0;i--){const d=new Date(Date.now()-i*864e5);out.push(dayKey(d))}return out}

/* ---------- admin ---------- */
const adminTabs=[['tablero','Tablero'],['vuelos','Vuelos'],['temporadas','Temporadas'],['reservas','Reservas'],['agencias','Agencias'],['pases','Pases'],['actividad','Actividad']];
async function viewFlights(){
  shell(adminTabs,'vuelos',`<section class="card"><h1>Vuelos e inventario</h1><div id="fxv"></div></section><section class="card actcard"><div id="actf"><p class="muted">Cargando…</p></div></section><section class="card"><h2>Todos los vuelos</h2><div id="ov"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const o=await api('/admin/overview'); const all=sessionStorage.getItem('beemo-allf')==='1'; const shown=all?o.flights:o.flights.slice(0,20);
  const CAP=150, up=o.flights.slice(0,12), avg=up.length?up.reduce((t,f)=>t+f.sold/CAP,0)/up.length:0, sm=k=>o.flights.reduce((t,f)=>t+f[k],0);
  $('#fxv').innerHTML=`<div class="fx-grid">
   <div class="fx-cell">${fxGauge({p:avg,mark:.8,markLabel:'Meta 80 %',val:fxCount(avg*100,'pct'),label:'ocupación media',sub:`próximos ${up.length} vuelos`})}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Próximos vuelos</h2><p class="fine">Sillas emitidas; lo rayado son apartadas sin pago.</p></div>
    ${fxPills(up.map((f,i)=>({label:fmtD(f.date,{day:'numeric',month:'short'}),p:f.sold/CAP,held:f.held/CAP,txt:Math.round(f.sold/CAP*100)+' %',on:i===0,aria:`${fmtD(f.date)} ${f.no}: ${f.sold} emitidas`,
      tip:`<b>${fmtD(f.date,{weekday:'short',day:'numeric',month:'short'})} · ${f.no}</b><br>${f.route.replace('-',' → ')}<br>${f.sold} emitidas · ${f.held} apartadas · ${f.free} libres`})),{refs:[{v:.8,label:'Meta 80 %'},{v:.35,label:'Equilibrio 35 %',crit:1}]})}</div>
   <ul class="fx-stats"><li>${fxCount(sm('sold'))}<span>sillas emitidas</span></li><li>${fxCount(sm('held'))}<span>apartadas sin pago</span></li><li>${fxCount(sm('free'))}<span>sillas libres</span></li><li>${fxCount(o.flights.length)}<span>vuelos programados</span></li></ul></div>`;
  drawActive(o);
  $('#ov').innerHTML=`${o.stripe?'':'<p class="warn">La pasarela Stripe aún no está conectada: las reservas con tarjeta quedan pendientes y se confirman a mano con «Marcar pagada».</p>'}
   <div class="tw"><table class="tbl"><thead><tr><th>Fecha</th><th>Vuelo</th><th>Emitidas</th><th>Apartadas</th><th>Libres</th><th>Business libres</th><th>Ocupación</th><th></th></tr></thead><tbody>${shown.map(f=>{const occ=Math.round((f.sold+f.held)/150*100);return `<tr><td>${fmtD(f.date)}</td><td>${f.no} · ${f.route.replace('-','→')}</td><td>${f.sold}</td><td>${f.held}</td><td>${f.free}</td><td>${f.biz_free}</td><td>${fxMini(occ/100,occ+' %')}</td><td class="acts"><button class="btn ghost sm" data-man="${f.route}|${f.date}">Manifiesto</button>${f.sold+f.held?`<button class="btn ghost sm" data-bk="${f.route}|${f.date}">Reservas</button>`:''}</td></tr>`}).join('')}</tbody></table></div>${o.flights.length>20?`<button class="btn ghost sm" id="allf" style="margin-top:12px">${all?'Ver solo los próximos 20':'Ver los '+o.flights.length+' vuelos'}</button>`:''}`;
  const af=$('#allf'); if(af) af.onclick=()=>{sessionStorage.setItem('beemo-allf',all?'0':'1');viewFlights()};
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]').forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
/* ---------- admin: live dashboard vs year-1 plan ---------- */
const usd0=n=>'US$'+Math.round(n||0).toLocaleString('es-CO');
const usdK=n=>{n=n||0;const a=Math.abs(n);return (n<0?'–':'')+(a>=1e6?'US$'+(a/1e6).toLocaleString('es-CO',{maximumFractionDigits:2})+' M':a>=1e3?'US$'+(a/1e3).toLocaleString('es-CO',{maximumFractionDigits:0})+' mil':'US$'+Math.round(a))};
const pct=(n,d=0)=>(n*100).toLocaleString('es-CO',{maximumFractionDigits:d})+' %';
const MES=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
const mlabel=m=>{const [y,mm]=m.split('-');return MES[+mm-1]+' '+y.slice(2)};
let DASH_T=null;
function status(kind,label){const ic={good:'✓',warning:'!',critical:'×',neutral:'·'}[kind];return `<span class="sts ${kind}"><i aria-hidden="true">${ic}</i>${label}</span>`}
function tipBind(root){const tip=$('#dtip');$$('[data-tip]',root).forEach(el=>{const show=e=>{tip.innerHTML=el.dataset.tip;tip.hidden=false;const r=el.getBoundingClientRect(),w=tip.offsetWidth;
  tip.style.left=Math.min(innerWidth-w-8,Math.max(8,r.left+r.width/2-w/2))+'px';tip.style.top=(r.top+scrollY-tip.offsetHeight-8)+'px'};
  el.addEventListener('pointerenter',show);el.addEventListener('focus',show);el.addEventListener('pointerleave',()=>tip.hidden=true);el.addEventListener('blur',()=>tip.hidden=true)})}
// stacked bars (emitted + pending) with a plan tick per category
function chartMonths(ms){const W=760,H=260,P={l:64,r:12,t:14,b:34},iw=W-P.l-P.r,ih=H-P.t-P.b;
  const max=Math.max(...ms.map(m=>Math.max(m.plan,m.emitted+m.pending)))*1.08||1, bw=iw/ms.length, y=v=>P.t+ih-v/max*ih;
  const ticks=[0,.25,.5,.75,1].map(f=>f*max);
  let g=ticks.map(t=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l-8}" y="${y(t)+4}" class="ax" text-anchor="end">${usdK(t)}</text>`).join('');
  ms.forEach((m,i)=>{const x=P.l+i*bw+bw*.2,w=bw*.6,he=m.emitted/max*ih,hp=m.pending/max*ih,ye=P.t+ih-he,yp=ye-hp-(hp?2:0);
    const tip=`<b>${mlabel(m.month)}</b><br>Emitido ${usd0(m.emitted)}<br>Pendiente ${usd0(m.pending)}<br>Plan ${usd0(m.plan)} · ${pct((m.emitted)/m.plan)} cumplido`;
    g+=`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${he?`<path d="M${x},${P.t+ih} v${-he+Math.min(4,he)} q0,-${Math.min(4,he)} ${Math.min(4,he)},-${Math.min(4,he)} h${w-2*Math.min(4,he)} q${Math.min(4,he)},0 ${Math.min(4,he)},${Math.min(4,he)} v${he-Math.min(4,he)} z" class="s1"/>`:''}
      ${hp?`<rect x="${x}" y="${yp}" width="${w}" height="${hp}" rx="3" class="s2"/>`:''}
      <line x1="${x-4}" x2="${x+w+4}" y1="${y(m.plan)}" y2="${y(m.plan)}" class="plan"/>
      <text x="${x+w/2}" y="${H-12}" class="ax" text-anchor="middle">${mlabel(m.month)}</text></g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ingresos por mes de vuelo frente al plan">${g}</svg>`}
// load factor per operation with reference lines
function chartOps(ops,plan){const W=760,H=240,P={l:44,r:110,t:14,b:44},iw=W-P.l-P.r,ih=H-P.t-P.b,bw=iw/Math.max(ops.length,1),y=v=>P.t+ih-v*ih;
  let g=[0,.25,.5,.75,1].map(t=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${P.l-8}" y="${y(t)+4}" class="ax" text-anchor="end">${t*100}%</text>`).join('');
  const ref=(v,l,c)=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(v)}" y2="${y(v)}" class="${c}"/><text x="${W-P.r+6}" y="${y(v)+4}" class="ax strong">${l} ${pct(v)}</text>`;
  g+=ref(plan.load,'Meta','ref')+ref(plan.load_min,'Mínimo','ref2')+ref(plan.breakeven_load,'Equilibrio','ref3');
  ops.forEach((o,i)=>{const x=P.l+i*bw+bw*.22,w=bw*.56,h=o.load*ih,hh=Math.max(0,(o.load_held-o.load)*ih);
    const tip=`<b>${fmtD(o.date,{weekday:'short',day:'numeric',month:'short'})} · ${esc(o.label)}</b><br>Ocupación ${pct(o.load)} (${o.sold} pax emitidos${o.held?` + ${o.held} apartados`:''})<br>Ingreso ${usd0(o.revenue)} · cubre ${pct(o.coverage)} del chárter<br>${o.seats_to_breakeven?`Faltan ~${o.seats_to_breakeven} sillas para el equilibrio`:'Costo del chárter cubierto'}`;
    g+=`<g class="hit" tabindex="0" data-tip="${esc(tip)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>
      ${h?`<rect x="${x}" y="${y(o.load)}" width="${w}" height="${h}" rx="3" class="s1"/>`:''}${hh?`<rect x="${x}" y="${y(o.load_held)}" width="${w}" height="${Math.max(0,hh-2)}" rx="3" class="s2"/>`:''}
      ${ops.length<=10||i%2===0?`<text x="${x+w/2}" y="${H-26}" class="ax" text-anchor="middle">${fmtD(o.date,{day:'numeric',month:'short'})}</text>`:''}${o.label.startsWith('Carnaval')?`<text x="${x+w/2}" y="${H-12}" class="ax" text-anchor="middle">Carnaval</text>`:''}</g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ocupación de las próximas operaciones">${g}</svg>`}
function chartDaily(ds){const W=760,H=170,P={l:64,r:12,t:10,b:26},iw=W-P.l-P.r,ih=H-P.t-P.b,max=Math.max(...ds.map(d=>d.revenue))*1.1||1,bw=iw/ds.length,y=v=>P.t+ih-v/max*ih;
  let g=[0,.5,1].map(f=>`<line x1="${P.l}" x2="${W-P.r}" y1="${y(f*max)}" y2="${y(f*max)}" class="grid"/><text x="${P.l-8}" y="${y(f*max)+4}" class="ax" text-anchor="end">${usdK(f*max)}</text>`).join('');
  ds.forEach((d,i)=>{const h=d.revenue/max*ih,x=P.l+i*bw+1,w=Math.max(2,bw-3);g+=`<g class="hit" tabindex="0" data-tip="${esc(`<b>${fmtD(d.date,{weekday:'short',day:'numeric',month:'short'})}</b><br>${d.bookings} ${d.bookings===1?'reserva':'reservas'} · ${usd0(d.revenue)}`)}"><rect x="${P.l+i*bw}" y="${P.t}" width="${bw}" height="${ih}" fill="transparent"/>${h?`<rect x="${x}" y="${y(d.revenue)}" width="${w}" height="${h}" rx="2" class="s1"/>`:''}${i%5===4||i===ds.length-1?`<text x="${x+w/2}" y="${H-8}" class="ax" text-anchor="middle">${fmtD(d.date,{day:'numeric',month:'short'})}</text>`:''}</g>`});
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ventas de los últimos 30 días">${g}</svg>`}
function barList(rows,total){const max=Math.max(...rows.map(r=>r.v),1);return `<ul class="blist">${rows.map(r=>`<li tabindex="0" data-tip="${esc(`<b>${esc(r.n)}</b><br>${usd0(r.v)}${total?` · ${pct(r.v/total,1)}`:''}`)}"><span class="bl-n">${esc(r.n)}</span><span class="bl-b"><i style="width:${r.v/max*100}%"></i></span><span class="bl-v">${usdK(r.v)}${total?` <small>${pct(r.v/total)}</small>`:''}</span></li>`).join('')}</ul>`}
let dashLib=null, dashUnmount=null;
function loadDashLib(){ if(dashLib) return dashLib;
  dashLib=new Promise((ok,ko)=>{const l=document.createElement('link');l.rel='stylesheet';l.href='/dash/dashboard.css?v=5';document.head.appendChild(l);
    const sc=document.createElement('script');sc.src='/dash/dashboard.js?v=5';sc.onload=()=>window.BeemoDashboard?ok(window.BeemoDashboard):ko(new Error('bundle'));sc.onerror=ko;document.head.appendChild(sc)});
  return dashLib }
async function viewDashboard(){
  clearInterval(DASH_T);
  shell(adminTabs,'tablero',`<div id="dash"><section class="card"><p class="muted">Cargando el tablero…</p></section></div><div id="dtip" class="dtip" role="tooltip" hidden></div>`);
  try{ const lib=await loadDashLib(); const el=$('#dash'); if(!el) return; el.innerHTML=''; dashUnmount=lib.mount(el,{fetchJson:p=>api(p)}) }
  catch(e){ // fallback: the light version without React
    await drawDash(); DASH_T=setInterval(()=>{if(location.hash.slice(1)==='tablero'||!location.hash)drawDash();else clearInterval(DASH_T)},60000) }
}
async function drawDash(){
  let d; try{d=await api('/admin/dashboard')}catch(e){return}
  const k=d.kpis,P=d.plan, box=$('#dash'); if(!box) return;
  const loadState=k.ops_next30?(k.load_next30>=P.load?['good','Sobre la meta']:k.load_next30>=P.load_min?['warning','Bajo la meta']:k.load_next30>=P.breakeven_load?['warning','Sobre el equilibrio']:['critical','Bajo el equilibrio']):['neutral','Sin vuelos en 30 días'];
  const ntState=k.emitted?(k.nontariff>=P.nontariff_share?['good','En plan']:['warning','Bajo el plan']):['neutral','Sin ventas aún'];
  const resState=k.flown_ops?(k.flown_result>=0?['good','Positivo']:['critical','Negativo']):['neutral','Desde el primer vuelo'];
  const tile=(v,l,sub,st,big)=>`<li class="${big?'big':''}"><span class="tl">${l}</span><b>${v}</b><span class="ts">${sub}</span>${st?status(st[0],st[1]):''}</li>`;
  const mixRows=[['Tarifas',d.mix.fares],['Asientos',d.mix.seats],['Equipaje y prioridad',d.mix.extras],['Bebés en brazos',d.mix.infants],['Extras después de reservar',d.mix.addons]].map(([n,v])=>({n,v})).filter(r=>r.v>0);
  const mixTot=mixRows.reduce((t,r)=>t+r.v,0);
  box.innerHTML=`
  <section class="card dhead"><div><h1>Así va Beemo Air</h1><p class="muted">Ventas reales de beemoair.com y de las agencias, comparadas con el plan del año 1 (escenario medio del informe financiero). Se actualiza cada minuto.</p></div><p class="live"><i aria-hidden="true"></i>Actualizado ${new Date(d.at).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</p></section>
  <ul class="tiles">
   ${tile(usd0(k.emitted),'Ingreso emitido',`${pct(k.emitted/P.revenue,1)} del plan anual de ${usdK(P.revenue)}`,null,1)}
   ${tile(usd0(k.pending),'Por cobrar',`Reservas apartadas sin pago`,null)}
   ${tile(k.pax_legs.toLocaleString('es-CO'),'Pasajeros emitidos',`Trayectos · plan ${P.pax.toLocaleString('es-CO')} al año`,null)}
   ${tile(k.ops_next30?pct(k.load_next30):'—','Ocupación próximos 30 días',`${k.ops_next30} operaciones · con apartados ${pct(k.load_next30_held)} · meta ${pct(P.load)}`,loadState)}
   ${tile(usd0(k.flown_result),'Resultado de vuelos realizados',`${k.flown_ops} operaciones · ingreso menos chárter de ${usd0(P.charter_per_op)}`,resState)}
   ${tile(k.emitted?pct(k.nontariff,1):'—','Ingreso no tarifario',`Asientos, equipaje y extras · plan ${pct(P.nontariff_share)}`,ntState)}
   ${tile(usd0(k.pass_revenue),'Pases de temporada',`${k.passes_sold} pagados · ${k.pass_segments_left} trayectos por volar`,null)}
   ${tile(usd0(k.cash_due),'Efectivo por consignar',`Agencias · comisiones causadas ${usd0(k.commission)}`,null)}
   ${tile(usd0(k.revenue_7d),'Ventas últimos 7 días',`${k.bookings_7d} ${k.bookings_7d===1?'reserva':'reservas'} nuevas`,null)}
  </ul>
  <section class="card"><div class="ch-h"><div><h2>Ingresos por mes de vuelo frente al plan</h2><p class="muted">Lo vendido se asigna al mes en que vuela el pasajero. Comprometido para el año 1: ${usd0(k.committed_year1)} de ${usdK(P.revenue)}.</p></div>
   <ul class="legend"><li><i class="s1"></i>Emitido</li><li><i class="s2"></i>Pendiente de pago</li><li><i class="plan"></i>Plan del mes</li></ul></div>
   ${chartMonths(d.months)}
   <details class="tview"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>Mes</th><th>Emitido</th><th>Pendiente</th><th>Plan</th><th>Cumplimiento</th></tr></thead><tbody>${d.months.map(m=>`<tr><td>${mlabel(m.month)}</td><td>${usd0(m.emitted)}</td><td>${usd0(m.pending)}</td><td>${usd0(m.plan)}</td><td>${pct(m.emitted/m.plan,1)}</td></tr>`).join('')}</tbody></table></details></section>
  <section class="card"><div class="ch-h"><div><h2>Ocupación de las próximas operaciones</h2><p class="muted">Cada operación es ida y vuelta. Equilibrio del plan: ${pct(P.breakeven_load)} con ingresos no tarifarios; solo con tiquetes, ${pct(P.breakeven_tickets_only)}.</p></div>
   <ul class="legend"><li><i class="s1"></i>Emitido</li><li><i class="s2"></i>Apartado sin pago</li></ul></div>
   ${d.upcoming.length?chartOps(d.upcoming,P):'<p class="muted">No hay operaciones próximas.</p>'}
   <details class="tview"><summary>Ver como tabla</summary><table class="tbl"><thead><tr><th>Fecha</th><th>Operación</th><th>Ocupación</th><th>Ingreso</th><th>Cubre del chárter</th><th>Sillas para el equilibrio</th></tr></thead><tbody>${d.upcoming.map(o=>`<tr><td>${fmtD(o.date)}</td><td>${esc(o.label)}</td><td>${pct(o.load)}</td><td>${usd0(o.revenue)}</td><td>${pct(o.coverage)}</td><td>${o.seats_to_breakeven}</td></tr>`).join('')}</tbody></table></details></section>
  <div class="dgrid"><section class="card"><h2>Mezcla de ingresos emitidos</h2>${mixRows.length?barList(mixRows,mixTot):'<p class="muted">Aún no hay ventas emitidas.</p>'}</section>
   <section class="card"><h2>Ventas por canal</h2>${d.channels.length?barList(d.channels.map(c=>({n:c.name,v:c.revenue})),d.channels.reduce((t,c)=>t+c.revenue,0)):'<p class="muted">Aún no hay ventas emitidas.</p>'}</section></div>
  <section class="card"><h2>Ventas de los últimos 30 días</h2><p class="muted">Reservas nuevas por día, emitidas y pendientes.</p>${chartDaily(d.daily)}</section>
  <section class="card"><h2>Hitos</h2><ol class="miles">${d.milestones.map(m=>{const past=m.date&&m.date<new Date().toISOString().slice(0,10);
     let st; if(m.kind==='flag') st=m.value>=1?['good','Logrado']:['warning','Pendiente']; else if(m.kind==='manual') st=past?['warning','Verificar']:['neutral','Próximo']; else st=m.value>=m.target?['good','Logrado']:past?['critical','No alcanzado']:['neutral','En curso'];
     const prog=m.kind!=='manual'&&m.kind!=='flag'?`<span class="bar wide"><i style="width:${Math.min(100,m.value/m.target*100)}%"></i></span>`:'';
     return `<li><span class="md">${m.date?fmtD(m.date,{day:'numeric',month:'short',year:'numeric'}):'Continuo'}</span><div><b>${esc(m.title)}</b><p class="muted">${esc(m.detail)}</p>${prog}</div>${status(st[0],st[1])}</li>`}).join('')}</ol></section>
  <section class="card"><h2>Plan del año 1</h2><p class="muted">Escenario medio del informe para el Fondo Patria Milagro (dic 2026 – nov 2027).</p>
   <ul class="kpis plan"><li><b>${usdK(P.revenue)}</b><span>ingreso total</span></li><li><b>${usdK(P.ebitda)}</b><span>EBITDA · margen ${pct(P.margin)}</span></li><li><b>${P.ops}</b><span>operaciones</span></li><li><b>${usd0(P.rev_per_op)}</b><span>ingreso por operación</span></li><li><b>${usd0(P.charter_per_op)}</b><span>chárter por operación</span></li><li><b>${usdK(P.cash_need)}</b><span>necesidad máxima de caja</span></li></ul></section>`;
  tipBind(box);
}
const SEASON_NAME={'2027-02-06':'Carnaval de Barranquilla','2027-02-10':'Carnaval de Barranquilla'};
// plano mínimo de la cabina (horizontal, nariz a la izquierda) con la ocupación
function miniCabin(rows){
  const st={};rows.forEach(r=>st[r.seat]=r.status);
  const S=13,G=3,AIS=12,X0=58,Y0=30,colY=c=>Y0+'ABCDEF'.indexOf(c)*(S+G)+('DEF'.includes(c)?AIS:0);
  let x=X0;const rx={};for(let r=1;r<=ROWS;r++){if(r===BIZ+1)x+=8;if(r===EXIT[0])x+=6;rx[r]=x;x+=S+G;if(r===EXIT[1])x+=6}
  const W=x+70,H=Y0*2+6*(S+G)-G+AIS,cy=H/2,top=Y0-12,bot=H-Y0+12;
  let g=`<path class="mc-wing" d="M${rx[11]} ${top} L${rx[14]} ${top-26} L${rx[17]+S} ${top-26} L${rx[16]+S} ${top} Z M${rx[11]} ${bot} L${rx[14]} ${bot+26} L${rx[17]+S} ${bot+26} L${rx[16]+S} ${bot} Z"/>
   <path class="mc-wing" d="M${W-48} ${top+8} L${W-26} ${top-16} L${W-12} ${top-16} L${W-18} ${cy} L${W-12} ${bot+16} L${W-26} ${bot+16} L${W-48} ${bot-8} Z"/>
   <path class="mc-body" d="M${X0-14} ${top} H${W-40} Q${W-8} ${cy} ${W-40} ${bot} H${X0-14} C${X0-62} ${bot} ${X0-58} ${top} ${X0-14} ${top} Z"/>
   <path class="mc-win" d="M${X0-36} ${cy-14} q-8 14 0 28"/>`;
  let n={confirmed:0,pending:0,free:0};
  for(let r=1;r<=ROWS;r++)for(const c of COLS){if(!isSeat(r,c))continue;const id=r+c,k=st[id]==='confirmed'?'sold':st[id]==='pending'?'held':'free';n[k==='sold'?'confirmed':k==='held'?'pending':'free']++;
    const biz=r<=BIZ,w=biz?S+2:S,y=biz?colY(c)+('AC'.includes(c)?('A'===c?0:-(S+G)/2):('DF'.includes(c)?('F'===c?0:(S+G)/2):0)):colY(c);
    g+=`<rect x="${rx[r]}" y="${y}" width="${w}" height="${biz?S+2:S}" rx="3.5" class="mc-s ${k}${biz?' biz':''}" style="--d:${r*22}ms"><title>${id} · ${k==='sold'?'emitida':k==='held'?'apartada sin pago':'libre'}${biz?' · Business':''}</title></rect>`}
  [1,BIZ+1,10,EXIT[0],20,ROWS].forEach(r=>g+=`<text x="${rx[r]+S/2}" y="${Y0-2}" class="mc-n" text-anchor="middle">${r}</text>`);
  g+=`<text x="${X0-6}" y="${colY('A')+S-3}" class="mc-n" text-anchor="end">A</text><text x="${X0-6}" y="${colY('F')+S-3}" class="mc-n" text-anchor="end">F</text>`;
  return `<figure class="mcab fx-wait"><svg viewBox="-6 -24 ${W+12} ${H+48}" role="img" aria-label="Ocupación de la cabina: ${n.confirmed} emitidas, ${n.pending} apartadas, ${n.free} libres">${g}</svg>
   <figcaption><span><i class="sold"></i>Emitida</span><span><i class="held"></i>Apartada sin pago</span><span><i class="free"></i>Libre</span><span><i class="free biz"></i>Business (filas 1–3)</span><span class="mc-hint">Toca «Ver manifiesto» para ver los pasajeros.</span></figcaption></figure>`}
function flightCard(f,season,picker='',cabin=''){
  const CAP=150, late=season&&f.days_to_deadline<0, ok=season&&f.sold>=f.min_seats, goal=season?f.min_seats:Math.round(CAP*.8);
  const soon=f.hours_to_flight<=24?`sale en ${f.hours_to_flight} ${f.hours_to_flight===1?'hora':'horas'}`:`faltan ${f.days_to_flight} días`;
  const state=season?(ok?['confirmed','Meta alcanzada']:late?['cancelled','Plazo vencido']:f.days_to_deadline<=14?['pending','En riesgo']:['pending','En venta'])
    :(f.hours_to_flight<=24?['pending','Sale hoy']:f.sold>=goal?['confirmed','Meta alcanzada']:['confirmed','En venta']);
  const gauge=season?fxGauge({p:f.sold/f.min_seats,val:`${fxCount(f.sold)}<i class="fx-of">/ ${f.min_seats}</i>`,label:'sillas para confirmar',sub:`${late?'El plazo venció el':'Plazo'} ${fmtD(f.deadline,{day:'numeric',month:'short'})}${late?'':` · faltan ${f.days_to_deadline} días`}`})
    :fxGauge({p:f.sold/CAP,mark:.8,markLabel:'Meta 80 % · 120 sillas',val:`${fxCount(f.sold)}<i class="fx-of">/ ${CAP}</i>`,label:'sillas emitidas',sub:`${Math.round(f.sold/CAP*100)} % de ocupación`});
  return `<article class="season"><div class="ss-h"><div><p class="kick">${season?esc(SEASON_NAME[f.date]||'Vuelo de temporada'):'Vuelo activo'}</p><h2>${f.route.replace('-',' → ')} · ${f.no}</h2><p class="muted">${fmtD(f.date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} · ${f.dep}–${f.arr} · ${soon}</p></div><span class="st ${state[0]}">${state[1]}</span></div>
     ${picker}
     <div class="fx-grid ss">
      <div class="fx-cell">${gauge}</div>
      <div class="fx-cell">${fxDonut([{v:f.sold,cls:'c1',label:'Emitidas'},{v:f.held,cls:'c2',label:'Apartadas sin pago'},{v:f.free,cls:'c3',label:'Libres'}],fxCount(f.sold+f.held),'de 150 sillas')}</div>
      <div class="fx-cell fx-wide"><ul class="fx-stats two"><li>${fxCount(f.revenue,'money')}<span>tarifas emitidas</span></li><li>${fxCount(Math.max(0,goal-f.sold))}<span>sillas faltan para la meta</span></li>${season?'':`<li>${fxCount(f.biz_free)}<span>libres en Business</span></li><li>${fxCount(f.held)}<span>apartadas sin pago</span></li>`}</ul>
       <h3 class="fx-sub">Ventas por canal</h3>${f.channels.length?fxBars(f.channels.map(c=>({n:c.name,v:c.sold})),'int'):'<p class="muted">Todavía no hay ventas en este vuelo.</p>'}</div></div>
     ${cabin}
     <div class="acts"><button class="btn ghost sm" data-man="${f.route}|${f.date}">Ver manifiesto</button><button class="btn ghost sm" data-bk="${f.route}|${f.date}">Ver reservas</button></div></article>`}
let ACTF=null;
async function drawActive(o){
  const box=$('#actf'); if(!box) return;
  const up=o.flights.filter(f=>new Date(f.dep_at)>Date.now()).sort((a,b)=>a.dep_at.localeCompare(b.dep_at)).slice(0,6); if(!up.length){box.innerHTML='<p class="muted">No hay vuelos próximos programados.</p>';return}
  const cur=up.find(f=>f.route+'|'+f.date===ACTF)||up[0];
  let f,seats; try{[f,seats]=await Promise.all([api(`/admin/flight?route=${cur.route}&date=${cur.date}`),api(`/admin/manifest?route=${cur.route}&date=${cur.date}`)])}catch(e){box.innerHTML=`<p class="muted">${esc(e.message)}</p>`;return}
  const picker=`<div class="seg fx-pick" role="group" aria-label="Elegir vuelo">${up.map(x=>`<button type="button" data-actf="${x.route}|${x.date}" aria-pressed="${x===cur}">${fmtD(x.date,{weekday:'short',day:'numeric',month:'short'})} · ${x.route.replace('-','→')}</button>`).join('')}</div>`;
  box.innerHTML=flightCard(f,false,picker,miniCabin(seats));
  $$('[data-actf]',box).forEach(b=>b.onclick=()=>{ACTF=b.dataset.actf;drawActive(o)});
  $$('[data-man]',box).forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]',box).forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
async function viewSeasons(){
  shell(adminTabs,'temporadas',`<section class="card"><h1>Vuelos de temporada</h1><p class="muted">Cada vuelo de temporada se confirma si llega a 90 sillas vendidas 45 días antes de la salida; si no, se cancela sin costo.</p><div id="ss"><p class="muted">Cargando…</p></div></section><div id="man"></div>`);
  const list=await api('/admin/seasons');
  $('#ss').innerHTML=list.length?list.map(f=>flightCard(f,true)).join(''):'<p class="muted">No hay vuelos de temporada programados.</p>';
  $$('[data-man]').forEach(b=>b.onclick=()=>manifest(...b.dataset.man.split('|')));
  $$('[data-bk]').forEach(b=>b.onclick=()=>{BF={flight:b.dataset.bk};sessionStorage.setItem('beemo-bf',JSON.stringify(BF));location.hash='reservas'});
}
async function manifest(route,date){
  const rows=await api(`/admin/manifest?route=${route}&date=${date}`);const names={};rows.forEach(r=>names[r.seat]=r.name);
  $('#man').innerHTML=`<section class="card"><h2>Manifiesto ${route.replace('-',' → ')} · ${fmtD(date,{weekday:'long',day:'numeric',month:'long'})}</h2><div class="mwrap"><div class="tw"><table class="tbl"><thead><tr><th>Silla</th><th>Pasajero</th><th>Tarifa</th><th>Reserva</th><th>Canal</th><th>Estado</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${r.seat}</b></td><td>${esc(r.name)}${r.inf?' + bebé':''}${Object.keys(r.extras).length?`<br><small class="muted">${Object.keys(r.extras).map(k=>({bag:'maleta',bag2:'2.ª maleta',prio:'prioritario'})[k]).join(', ')}</small>`:''}</td><td>${r.fare}</td><td>${r.pnr}</td><td>${esc(r.channel)}</td><td><span class="st ${r.status}">${ST[r.status]}</span></td></tr>`).join('')||'<tr><td colspan="6" class="muted">Sin pasajeros todavía.</td></tr>'}</tbody></table></div>
   <div>${seatMap({taken:new Set(rows.map(r=>r.seat)),readOnly:true,names})}</div></div></section>`;
  $('#man').scrollIntoView({behavior:'smooth'});
}
let BF=null;
async function viewAdminBookings(){
  if(!BF){try{BF=JSON.parse(sessionStorage.getItem('beemo-bf')||'{}')}catch(e){BF={}}}
  shell(adminTabs,'reservas',`<section class="card"><h1>Reservas</h1>
   <form id="bf" class="srch filt"><label>Vuelo<select name="flight"><option value="">Todos los vuelos</option></select></label>
    <label>Canal<select name="agency"><option value="">Todos los canales</option><option value="web">beemoair.com</option></select></label>
    <label>Estado<select name="status"><option value="">Todos</option>${Object.entries(ST).map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select></label>
    <label>Buscar<input name="q" placeholder="Código, pasajero o correo"></label>
    <button type="button" class="btn ghost" id="bfX">Limpiar</button></form>
   <div id="bsum"></div><div id="abl"><p class="muted">Cargando…</p></div></section>`);
  const f=$('#bf'), opts=await api('/admin/booking-filters');
  f.flight.insertAdjacentHTML('beforeend',opts.flights.map(x=>`<option value="${x.route}|${x.date}">${fmtD(x.date)} · ${x.no} · ${x.route.replace('-','→')}</option>`).join(''));
  f.agency.insertAdjacentHTML('beforeend',opts.agencies.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join(''));
  for(const k of ['flight','agency','status','q']) if(BF[k]!=null) f[k].value=BF[k];
  let tm; const go=()=>{BF=Object.fromEntries(new FormData(f));sessionStorage.setItem('beemo-bf',JSON.stringify(BF));loadBookings()};
  f.onchange=go; f.q.oninput=()=>{clearTimeout(tm);tm=setTimeout(go,300)}; f.onsubmit=e=>{e.preventDefault();go()};
  $('#bfX').onclick=()=>{f.reset();go()};
  loadBookings();
}
async function loadBookings(){
  const qs=new URLSearchParams(Object.entries(BF||{}).filter(([k,v])=>v)).toString();
  const r=await api('/admin/bookings'+(qs?'?'+qs:'')), list=r.bookings;
  const byS=k=>list.filter(b=>b.status===k).length, days=lastDays(14), perDay=days.map(d=>list.filter(b=>dayKey(b.created)===d)), mx=Math.max(1,...perDay.map(x=>x.length));
  $('#bsum').innerHTML=`<div class="fx-grid rs">
   <div class="fx-cell">${fxDonut([{v:byS('confirmed'),cls:'c1',label:'Emitidas'},{v:byS('pending'),cls:'c2',label:'Pendientes de pago'},{v:byS('cancelled')+byS('expired'),cls:'c3',label:'Anuladas o vencidas'}],fxCount(list.length),list.length===1?'reserva':'reservas')}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Reservas por día</h2><p class="fine">Últimos 14 días, según los filtros.</p></div>${fxPills(perDay.map((x,i)=>({label:fmtD(days[i],{day:'numeric'}),p:x.length/mx,txt:String(x.length),on:i===13,aria:`${fmtD(days[i])}: ${x.length} reservas`,tip:`<b>${fmtD(days[i],{weekday:'short',day:'numeric',month:'short'})}</b><br>${x.length} ${x.length===1?'reserva':'reservas'} · ${money(x.reduce((t,b)=>t+b.total,0))}`})),{H:130})}</div>
  </div>
  <ul class="kpis sm"><li>${fxCount(r.count)}<span>${r.count===1?'reserva':'reservas'} · ${r.totals.pax} pasajeros</span></li><li>${fxCount(r.totals.confirmed,'money')}<span>emitido</span></li><li>${fxCount(r.totals.pending,'money')}<span>pendiente de pago</span></li><li class="due">${fxCount(r.totals.cash_due,'money')}<span>efectivo por consignar</span></li></ul>${r.count>list.length?`<p class="fine">Se muestran las ${list.length} más recientes. Usa los filtros para acotar.</p>`:''}`;
  $('#abl').innerHTML=list.length?`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Canal</th><th>Vuelo</th><th>Pasajeros</th><th>Total</th><th>Pago</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(b=>`<tr>
   <td><b>${b.pnr}</b><br><small class="muted">${fmtDT(b.created)}</small></td><td>${esc(b.agency||'beemoair.com')}</td><td>${b.legs.map(l=>`${l.route.replace('-','→')} ${fmtD(l.date)}<br><small class="muted">${l.no} · ${FARE[l.fare]} · ${l.seats.join(', ')}</small>`).join('<br>')}</td>
   <td>${b.pax.map(p=>esc(p.first+' '+p.last)+(p.inf?' + bebé':'')).join('<br>')}<br><small class="muted">${esc(b.contact.email)}</small></td><td>${money(b.total)}${b.due&&b.status!=='pending'?`<br><small class="muted">extras por cobrar ${money(b.due)}</small>`:''}</td>
   <td>${b.pay_method==='cash'?(b.settled?'Agencia · consignado':'Agencia · por consignar'):'Tarjeta'}</td><td><span class="st ${b.status}">${ST[b.status]}</span>${b.status==='pending'&&b.expires?`<br><small class="muted">hasta ${fmtDT(b.expires)}</small>`:''}</td>
   <td class="acts">${b.status==='pending'||b.due?`<button class="btn ghost sm" data-a="paid" data-p="${b.pnr}">Marcar pagada</button>`:''}${b.pay_method==='cash'&&b.status==='confirmed'&&!b.settled?`<button class="btn ghost sm" data-a="settle" data-p="${b.pnr}">Consignado</button>`:''}${['pending','confirmed'].includes(b.status)?`<button class="btn ghost sm danger" data-a="cancel" data-p="${b.pnr}">Anular</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No hay reservas con esos filtros.</p>';
  $$('[data-a]').forEach(b=>b.onclick=async()=>{const t={paid:'marcar como pagada',settle:'marcar como consignada',cancel:'anular (las sillas se liberan)'}[b.dataset.a];
    if(!confirm(`¿Seguro que quieres ${t} la reserva ${b.dataset.p}?`))return;try{await api(`/admin/bookings/${b.dataset.p}/${b.dataset.a}`,{body:{}});loadBookings()}catch(e){alert(e.message)}});
}
async function viewAgencies(){
  shell(adminTabs,'agencias',`<section class="card"><h1>Agencias</h1><p class="muted">Crea una agencia, ajusta su comisión y gestiona quién entra al portal.</p><h3 class="ag-new">Nueva agencia</h3><form id="newAg" class="ag-form"><label>Nombre de la agencia<input name="name" required></label><label>País<select name="country" required><option value="">Elige…</option><option>Colombia</option><option>Estados Unidos</option><option>Otro</option></select></label><label>Ciudad<input name="city"></label><label>NIT / EIN<input name="tax_id"></label><label>Contacto<input name="contact"></label><label>Correo<input name="email" type="email"></label><label>Teléfono<input name="phone"></label><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="3"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="0"></label><button class="btn lime">Crear agencia</button></form><p class="note" id="agN" hidden></p></section><section class="card"><h2>Resumen de agencias</h2><div id="agfx"></div></section><div id="agl" class="aglist"></div>`);
  $('#newAg').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));try{await api('/admin/agencies',{body:d});viewAgencies()}catch(err){note($('#agN'),err.message,'err')}};
  const list=await api('/admin/agencies');
  const tot=list.reduce((t,a)=>t+a.statement.sales,0);
  $('#agfx').innerHTML=`<div class="fx-grid ag2"><div class="fx-cell">${fxDonut([...list].sort((x,y)=>y.statement.sales-x.statement.sales).map((a,i)=>({v:a.statement.sales,cls:'c'+(i%3+1),label:a.name,txt:usd0(a.statement.sales)})),fxCount(tot,'usd'),'ventas de agencias')}</div>
   <ul class="fx-stats"><li>${fxCount(list.filter(a=>a.active).length)}<span>agencias activas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.bookings,0))}<span>reservas emitidas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.commission,0),'money')}<span>comisiones causadas</span></li><li>${fxCount(list.reduce((t,a)=>t+a.statement.cash_due,0),'money')}<span>efectivo por consignar</span></li></ul></div>`;
  const FLAG=c=>c==='Colombia'?'🇨🇴':c==='Estados Unidos'?'🇺🇸':'🌐';
  const DET=[['city','Ciudad'],['tax_id','NIT / EIN'],['address','Dirección'],['contact','Contacto'],['email','Correo'],['phone','Teléfono']];
  $('#agl').innerHTML=list.length?list.map(a=>`<section class="card ag ${a.active?'':'off'}">
   <header class="ag-h"><div><h2>${esc(a.name)}</h2><p class="ag-tags"><span class="ctry">${FLAG(a.country)} ${esc(a.country||'Sin país')}</span><span class="st ${a.active?'confirmed':'cancelled'}">${a.active?'Activa':'Inactiva'}</span></p></div>
    <button type="button" class="btn ghost sm" data-toggle="${a.id}" data-on="${a.active?1:0}">${a.active?'Desactivar agencia':'Activar agencia'}</button></header>
   <dl class="ag-dl">${DET.map(([k,t])=>`<div><dt>${t}</dt><dd>${a[k]?esc(a[k]):'<span class="muted">—</span>'}</dd></div>`).join('')}</dl>
   <div class="ag-fx">${(()=>{const st=a.statement,c=(st.cash_settled||0)+st.cash_due;return fxGauge({small:1,p:c?(st.cash_settled||0)/c:1,val:c?fxCount((st.cash_settled||0)/c*100,'pct'):'<b>Al día</b>',label:'efectivo consignado',sub:tot?`${Math.round(st.sales/tot*100)} % de las ventas de agencias`:'sin ventas todavía'})})()}
   <ul class="kpis sm ag-k"><li>${fxCount(a.statement.bookings)}<span>emitidas</span></li><li>${fxCount(a.statement.sales,'money')}<span>ventas</span></li><li>${fxCount(a.statement.commission,'money')}<span>comisión</span></li><li class="due">${fxCount(a.statement.cash_due,'money')}<span>por consignar</span></li></ul></div>
   <div class="ag-sec"><h3>Condiciones</h3><form class="ag-cond" data-ag="${a.id}"><label>Comisión %<input name="commission" type="number" step="0.5" min="0" max="30" value="${a.commission}"></label><label>Incentivo %<input name="incentive" type="number" step="0.5" min="0" max="30" value="${a.incentive}"></label><button class="btn ghost">Guardar</button></form></div>
   <div class="ag-sec"><h3>Usuarios <small class="muted">${a.users.length}</small></h3><ul class="users">${a.users.map(u=>`<li><span class="u-id"><b>${esc(u.name||u.email)}</b><small>${esc(u.email)}${u.must_change?' · debe cambiar la contraseña':''}${u.active?'':' · desactivado'}</small></span><span class="u-act"><button class="btn ghost sm" data-reset="${u.id}">Nueva contraseña temporal</button><button class="btn ghost sm" data-ut="${u.id}">${u.active?'Desactivar':'Activar'}</button></span></li>`).join('')||'<li class="muted empty">Esta agencia todavía no tiene usuarios. Agrega el primero con su correo: el portal te dará su contraseña temporal.</li>'}</ul>
    <form class="ag-nu" data-nu="${a.id}"><label>Nombre<input name="name"></label><label>Correo<input name="email" type="email" required></label><button class="btn ghost">Agregar usuario</button></form><p class="note" data-un="${a.id}" hidden></p></div></section>`).join(''):'<section class="card"><p class="muted">Aún no hay agencias. Crea la primera arriba.</p></section>';
  $$('[data-ag]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();await api('/admin/agencies/'+f.dataset.ag,{method:'PATCH',body:Object.fromEntries(new FormData(f))});viewAgencies()});
  $$('[data-toggle]').forEach(b=>b.onclick=async()=>{await api('/admin/agencies/'+b.dataset.toggle,{method:'PATCH',body:{active:b.dataset.on!=='1'}});viewAgencies()});
  const showPw=(id,r)=>note($(`[data-un="${id}"]`),`Contraseña temporal de ${r.email}: ${r.temp_password} — compártela por un canal seguro. Se pedirá cambiarla al entrar y no se vuelve a mostrar.`,'ok');
  $$('[data-nu]').forEach(f=>f.onsubmit=async e=>{e.preventDefault();try{const r=await api(`/admin/agencies/${f.dataset.nu}/users`,{body:Object.fromEntries(new FormData(f))});await viewAgencies();showPw(f.dataset.nu,r)}catch(err){note($(`[data-un="${f.dataset.nu}"]`),err.message,'err')}});
  $$('[data-reset]').forEach(b=>b.onclick=async()=>{if(!confirm('¿Generar una nueva contraseña temporal? La actual deja de funcionar.'))return;const id=b.closest('.ag').querySelector('[data-nu]').dataset.nu;const r=await api(`/admin/users/${b.dataset.reset}/reset`,{body:{}});await viewAgencies();showPw(id,r)});
  $$('[data-ut]').forEach(b=>b.onclick=async()=>{await api(`/admin/users/${b.dataset.ut}/toggle`,{body:{}});viewAgencies()});
}
const PST={active:'Publicado',soon:'Próximamente',inactive:'Oculto'};
const RLBL={'MIA-AXM':'Miami → Armenia','AXM-MIA':'Armenia → Miami','MIA-BAQ':'Miami → Barranquilla','BAQ-MIA':'Barranquilla → Miami'};
let PEDIT=null;
async function viewPasses(){
  shell(adminTabs,'pases',`<section class="card"><div class="hd"><h1>Tipos de pase</h1><button class="btn lime" id="pNew">Crear pase</button></div>
   <p class="muted">Lo publicado aparece en beemoair.com/pase-de-temporada y en el home; lo marcado como «Próximamente» se muestra sin botón de compra; lo oculto no se ve en la web.</p>
   <div id="pfx"></div><div id="pForm"></div><h2 class="fx-sub2">Catálogo</h2><div id="pp"><p class="muted">Cargando…</p></div></section>
   <section class="card"><h2>Pases vendidos</h2><div id="pl"><p class="muted">Cargando…</p></div></section>`);
  const [prods,list]=await Promise.all([api('/admin/pass-products'),api('/admin/passes')]);
  const paid=list.filter(p=>p.status==='paid'), segT=paid.reduce((t,p)=>t+p.total,0), segU=paid.reduce((t,p)=>t+p.total-p.left,0), mxs=Math.max(1,...prods.map(p=>p.sold||0));
  $('#pfx').innerHTML=`<div class="fx-grid ss">
   <div class="fx-cell">${fxGauge({p:segT?segU/segT:0,val:fxCount(segU),label:'trayectos usados',sub:`de ${segT} vendidos en pases pagados`})}</div>
   <div class="fx-cell">${fxDonut([{v:paid.length,cls:'c1',label:'Pagados'},{v:list.filter(p=>p.status==='pending').length,cls:'c2',label:'Pendientes de pago'},{v:list.filter(p=>p.status==='expired').length,cls:'c3',label:'Vencidos'}],fxCount(list.length),list.length===1?'pase':'pases')}</div>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Vendidos por tipo</h2><p class="fine">${fxCount(paid.reduce((t,p)=>t+p.price,0),'money')} cobrados en pases pagados</p></div>
    ${fxPills(prods.filter(p=>p.status!=='inactive').map((p,i)=>({label:p.name.replace(/^Pase\s*/,'').slice(0,12),p:(p.sold||0)/mxs,txt:String(p.sold||0),on:(p.sold||0)===mxs&&mxs>0&&p.sold>0,aria:`${p.name}: ${p.sold||0} vendidos`,tip:`<b>${esc(p.name)}</b><br>${p.sold||0} vendidos${p.price?` · ${money(p.price)}`:''}<br>${PST[p.status]}`})),{H:130})}</div></div>`;
  $('#pNew').onclick=()=>{PEDIT={status:'inactive',valid_months:12,routes:['MIA-AXM','AXM-MIA'],sort:100};passForm()};
  $('#pp').innerHTML=prods.length?`<div class="tw"><table class="tbl"><thead><tr><th>Pase</th><th>Trayectos</th><th>Precio</th><th>Rutas</th><th>Vigencia</th><th>Vendidos</th><th>Estado</th><th></th></tr></thead><tbody>${prods.map(p=>`<tr>
    <td><b>${esc(p.name)}</b>${p.badge?` <span class="st confirmed">${esc(p.badge)}</span>`:''}<br><small class="muted">${esc(p.description||'')}</small></td>
    <td>${p.segments??'—'}</td><td>${p.price?money(p.price):'—'}${p.per_segment?`<br><small class="muted">${money(p.per_segment)} c/u · ahorra US$${p.savings}</small>`:''}</td>
    <td>${p.routes.map(r=>RLBL[r]||r).join('<br>')||'—'}</td><td>${p.valid_months} meses</td><td>${p.sold}</td>
    <td><select data-pst="${p.id}" aria-label="Estado de ${esc(p.name)}">${Object.entries(PST).map(([k,v])=>`<option value="${k}" ${k===p.status?'selected':''}>${v}</option>`).join('')}</select></td>
    <td class="acts"><button class="btn ghost sm" data-pe="${p.id}">Editar</button><button class="btn ghost sm" data-pc="${p.id}">Clonar</button></td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">No hay tipos de pase.</p>';
  $$('[data-pst]').forEach(sel=>sel.onchange=async()=>{try{await api('/admin/pass-products/'+sel.dataset.pst,{method:'PATCH',body:{status:sel.value}});viewPasses()}catch(e){alert(e.message);viewPasses()}});
  $$('[data-pe]').forEach(b=>b.onclick=()=>{PEDIT=prods.find(p=>p.id===+b.dataset.pe);passForm()});
  $$('[data-pc]').forEach(b=>b.onclick=async()=>{const r=await api(`/admin/pass-products/${b.dataset.pc}/clone`,{body:{}});const all=await api('/admin/pass-products');PEDIT=all.find(p=>p.id===r.id);await viewPasses()});
  if(PEDIT) passForm();
  $('#pl').innerHTML=list.length?`<div class="tw"><table class="tbl"><thead><tr><th>Código</th><th>Pase</th><th>Cliente</th><th>Trayectos</th><th>Precio</th><th>Vence</th><th>Estado</th><th></th></tr></thead><tbody>${list.map(p=>`<tr><td><b>${p.code}</b><br><small class="muted">${fmtDT(p.created)}</small></td><td>${esc(p.product)}</td><td>${esc(p.name)}<br><small class="muted">${esc(p.email)}</small></td><td>${fxMini(p.total?(p.total-p.left)/p.total:0,`${p.total-p.left}/${p.total}`)}</td><td>${money(p.price)}</td><td>${fmtD(p.exp,{day:'numeric',month:'short',year:'numeric'})}</td><td><span class="st ${p.status==='paid'?'confirmed':p.status}">${{pending:'Pendiente de pago',paid:'Pagado',expired:'Vencido'}[p.status]||p.status}</span></td><td>${p.status!=='paid'?`<button class="btn ghost sm" data-pp="${p.code}">Marcar pagado</button>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<p class="muted">Todavía no hay pases vendidos.</p>';
  $$('[data-pp]').forEach(b=>b.onclick=async()=>{if(!confirm(`¿Marcar el pase ${b.dataset.pp} como pagado?`))return;await api(`/admin/passes/${b.dataset.pp}/paid`,{body:{}});viewPasses()});
}
function passForm(){
  const p=PEDIT, box=$('#pForm'); if(!box) return;
  box.innerHTML=`<form id="pf" class="pform"><h2>${p.id?'Editar pase':'Nuevo pase'}</h2>
   <div class="pf-grid">
    <label>Nombre (español)<input name="name" value="${esc(p.name||'')}" required></label><label>Nombre (inglés)<input name="name_en" value="${esc(p.name_en||'')}"></label>
    <label>Descripción (español)<input name="description" value="${esc(p.description||'')}"></label><label>Descripción (inglés)<input name="description_en" value="${esc(p.description_en||'')}"></label>
    <label>Etiqueta (opcional)<input name="badge" value="${esc(p.badge||'')}" placeholder="Más ahorro"></label><label>Etiqueta (inglés)<input name="badge_en" value="${esc(p.badge_en||'')}"></label>
    <label>Trayectos<input name="segments" type="number" min="1" max="40" value="${p.segments??''}"></label><label>Precio total (US$, impuestos incluidos)<input name="price" type="number" min="1" step="0.01" value="${p.price??''}"></label>
    <label>Vigencia (meses)<input name="valid_months" type="number" min="1" max="36" value="${p.valid_months||12}"></label><label>Orden en la web<input name="sort" type="number" value="${p.sort??100}"></label>
   </div>
   <fieldset class="rts"><legend>Rutas donde sirve</legend>${Object.entries(RLBL).map(([k,v])=>`<label class="chk"><input type="checkbox" name="routes" value="${k}" ${(p.routes||[]).includes(k)?'checked':''}> ${v}</label>`).join('')}</fieldset>
   <label>Estado<select name="status">${Object.entries(PST).map(([k,v])=>`<option value="${k}" ${k===p.status?'selected':''}>${v}</option>`).join('')}</select></label>
   <p class="fine" id="pfCalc"></p><p class="note" hidden></p>
   <div class="acts"><button class="btn lime">${p.id?'Guardar cambios':'Crear pase'}</button><button type="button" class="btn ghost" id="pfX">Cancelar</button></div></form>`;
  const f=$('#pf'), calc=()=>{const n=+f.segments.value,pr=+f.price.value;$('#pfCalc').textContent=n&&pr?`${money(pr/n)} por trayecto · el cliente ahorra US$${Math.max(0,Math.round(395*n-pr))} frente a ${n} tiquetes Classic de US$395.`:''};
  f.segments.oninput=f.price.oninput=calc; calc();
  $('#pfX').onclick=()=>{PEDIT=null;box.innerHTML=''};
  f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f));d.routes=$$('[name=routes]:checked',f).map(x=>x.value);
    try{if(p.id) await api('/admin/pass-products/'+p.id,{method:'PATCH',body:d}); else await api('/admin/pass-products',{body:d}); PEDIT=null; viewPasses()}catch(err){note($('.note',f),err.message,'err')}};
  box.scrollIntoView({behavior:'smooth',block:'start'});
}
async function viewLog(){
  shell(adminTabs,'actividad',`<section class="card"><h1>Actividad</h1><div id="lg"></div></section>`);
  const l=await api('/admin/log'), days=lastDays(14), per=days.map(d=>l.filter(x=>dayKey(x.at)===d).length), mx=Math.max(1,...per), who=new Set(l.map(x=>x.who).filter(Boolean));
  $('#lg').innerHTML=`<div class="fx-grid rs"><ul class="fx-stats"><li>${fxCount(per[13])}<span>movimientos hoy</span></li><li>${fxCount(per.reduce((a,b)=>a+b,0))}<span>en 14 días</span></li><li>${fxCount(who.size)}<span>usuarios con actividad</span></li></ul>
   <div class="fx-cell fx-wide"><div class="fx-h"><h2>Movimientos por día</h2><p class="fine">Últimos 14 días.</p></div>${fxPills(per.map((n,i)=>({label:fmtD(days[i],{day:'numeric'}),p:n/mx,txt:String(n),on:i===13,aria:`${fmtD(days[i])}: ${n} movimientos`,tip:`<b>${fmtD(days[i],{weekday:'short',day:'numeric',month:'short'})}</b><br>${n} ${n===1?'movimiento':'movimientos'}`})),{H:130})}</div></div>
   <h2 class="fx-sub2">Últimos movimientos</h2><ol class="fx-tl">${l.map((x,i)=>`<li style="--d:${Math.min(i,20)*35}ms"><i aria-hidden="true"></i><time>${fmtDT(x.at)}</time><b>${esc(x.who||'Sistema')}</b><span>${esc(x.what)}</span></li>`).join('')||'<li class="muted">Sin actividad todavía.</li>'}</ol>`;
}

/* ---------- router ---------- */
async function boot(){
  if(dashUnmount){try{dashUnmount()}catch(e){} dashUnmount=null}
  if(!token){return viewLogin()}
  if(!me){try{me=await api('/me')}catch(e){return}}
  if(me.must_change) return viewPassword();
  const h=location.hash.slice(1);
  try{
    if(me.role==='admin'){({tablero:viewDashboard,vuelos:viewFlights,temporadas:viewSeasons,reservas:viewAdminBookings,agencias:viewAgencies,pases:viewPasses,actividad:viewLog}[h]||viewDashboard)()}
    else{({nueva:viewNew,reservas:viewBookings,cuenta:viewStatement}[h]||viewNew)()}
  }catch(e){console.error(e)}
}
window.addEventListener('hashchange',boot);
window.addEventListener('unhandledrejection',e=>{const m=$('#main');if(m&&e.reason&&e.reason.message){const p=document.createElement('p');p.className='note err';p.textContent=e.reason.message;m.prepend(p)}});
boot();
})();
