// ============================================================
// דשבורד ניהול גיוס — הדגמה סטטית (GitHub Pages).
// מנוע חישוב צד-לקוח: משחזר את ה-API של השרת (kpi/forecast/events/filters)
// מעל נתונים סינתטיים ב-data/*.json. אין שרת, אין מסד נתונים, קריאה בלבד.
// ============================================================
let META=null, DATA_ALL=[], DATA_IN=[], EV_W=[], EV_S=[], BOUNDS={min:null,max:null};
const _DAY=86400000;
let _base=null;
function offToStr(off){ return new Date(_base.getTime()+off*_DAY).toISOString().slice(0,10); }

async function loadData(){
  const [c,e,m] = await Promise.all([
    fetch('data/candidates.json').then(r=>r.json()),
    fetch('data/events.json').then(r=>r.json()),
    fetch('data/meta.json').then(r=>r.json()),
  ]);
  META=m; _base=new Date(m.base_date+'T00:00:00Z');
  const rn=m.roles, un=m.units, sn=m.stages, sr=m.stage_range;
  const byId=new Array(c.rows.length);
  for(const r of c.rows){
    const o={ id:r[0], role:rn[r[1]], district:un[r[2]], stage:sn[r[4]],
              range:sr[sn[r[4]]], days:r[5], last:offToStr(r[6]), inproc:r[7]===1 };
    DATA_ALL.push(o); if(o.inproc) DATA_IN.push(o); byId[o.id]=o;
  }
  // גבולות ציר הזמן (על כלל האוכלוסייה)
  let mn=null,mx=null; for(const o of DATA_ALL){ if(mn===null||o.last<mn)mn=o.last; if(mx===null||o.last>mx)mx=o.last; }
  BOUNDS={min:mn,max:mx};
  // אירועים -> אובייקטים, מצורפים לתפקיד/מחוז של המועמד
  const reasons=m.reasons, wr=m.withdraw_reason;
  for(const r of e.rows){
    const cand=byId[r[0]]||{role:'',district:''};
    const o={ cid:r[0], stage:sn[r[4]], role:cand.role, district:cand.district,
              reason: r[1]===0?wr:reasons[r[3]], date:offToStr(r[2]), inproc:r[5]===1 };
    (r[1]===0?EV_W:EV_S).push(o);
  }
}

// ---------- סינון מועמדים (מקביל ל-_filters_sql + _stage_source) ----------
function filterCands(f){
  f=f||{};
  const rows=(f.mode==='all')?DATA_ALL:DATA_IN;
  const rset=(f.roles!==undefined)?new Set(f.roles):null;      // [] -> אפס תוצאות
  const dset=(f.districts!==undefined)?new Set(f.districts):null;
  let wmin=(f.waiting&&f.waiting.length)?Math.min.apply(null,f.waiting):null;
  const from=f.date_from||null, to=f.date_to||null;
  let rangeSet=null;
  if(f.ranges!==undefined){ if(!f.ranges.length) return []; rangeSet=new Set(f.ranges.map(Number)); }
  let stageSet=null;
  if(f.metrics!==undefined){
    if(!f.metrics.length) return [];
    let all=false; const st=new Set();
    for(const mm of f.metrics){ const v=META.range_stage_map[mm];
      if(v==='__ALL__'){ all=true; break; } (v||[]).forEach(s=>st.add(s)); }
    if(!all) stageSet=st;
  }
  return rows.filter(c=>{
    if(rset && !rset.has(c.role)) return false;
    if(dset && !dset.has(c.district)) return false;
    if(wmin!==null && !(c.days>wmin)) return false;
    if(from && c.last<from) return false;
    if(to && c.last>to) return false;
    if(rangeSet && !rangeSet.has(c.range)) return false;
    if(stageSet && !stageSet.has(c.stage)) return false;
    return true;
  });
}
function _target(no){ const r=META.ranges.find(x=>x.no===no); return r?r.target:1e9; }

// ---------- api_filters ----------
function computeFilters(){
  const inRole={}, inDist={}, allDist={};
  DATA_IN.forEach(c=>{ inRole[c.role]=(inRole[c.role]||0)+1; inDist[c.district]=(inDist[c.district]||0)+1; });
  DATA_ALL.forEach(c=>{ allDist[c.district]=(allDist[c.district]||0)+1; });
  const sg={}; for(const [k,arr] of Object.entries(META.supergroups)) arr.forEach(r=>sg[r]=k);
  const roles=META.roles.map(name=>({name, supergroup:sg[name]||null, active:inRole[name]||0}));
  const districts=META.units.slice().sort((a,b)=>(allDist[b]||0)-(allDist[a]||0))
        .map(name=>({name, active:inDist[name]||0}));
  return { roles, supergroups:META.supergroups, status:META.status, districts,
           ranges:META.ranges.map(r=>({no:r.no,name:r.name})),
           metrics:META.metrics, waiting:META.waiting };
}

// ---------- api_kpi ----------
function _kpiFacet(f, key, field){ const o=Object.assign({},f); delete o[key];
  const m={}; filterCands(o).forEach(c=>{ m[c[field]]=(m[c[field]]||0)+1; }); return m; }
function _modeFacet(f){ const o=Object.assign({},f); delete o.mode; const out={};
  ['in','all'].forEach(mode=>{ out[mode]=filterCands(Object.assign({},o,{mode})).length; }); return out; }

// סדרת זמן חודשית לגרף המגמה — "כמה בכל חודש" לאורך הזמן (החודש מיוצג
// בתאריך הראשון שלו). מקביל ל-_trend_by_month בשרת. idField (רשות) -> ספירת
// מועמדים ייחודית לצד ספירת האירועים (מסכי האירועים, שם שורה != מועמד).
function _monthStart(iso){ return iso.slice(0,7)+'-01'; }
function _trendMonth(rows, dateField, idField){
  const m={};
  rows.forEach(o=>{ const dt=o[dateField]; if(!dt) return; const w=_monthStart(dt);
    const g=m[w]||(m[w]={count:0, ppl:idField?new Set():null});
    g.count++; if(idField) g.ppl.add(o[idField]); });
  return Object.keys(m).sort().map(w=>{ const r={period:w, count:m[w].count};
    if(idField) r.people=m[w].ppl.size; return r; });
}

function computeKpi(f){
  const rows=filterCands(f);
  const total=rows.length;
  const stuck90=rows.filter(c=>c.days>90).length;
  const ranges=[];
  for(let b=1;b<=5;b++){
    const t=_target(b); const sub=rows.filter(c=>c.range===b);
    const cnt=sub.length, over60=sub.filter(c=>c.days>60).length,
          over_t=sub.filter(c=>c.days>t).length;
    const pct=cnt?Math.round(1000*over_t/cnt)/10:null;
    let light; if(!cnt) light='אין נתונים'; else if(pct<10) light='ירוק'; else if(pct<=25) light='צהוב'; else light='אדום';
    const rn=META.ranges.find(x=>x.no===b);
    ranges.push({no:b, name:rn.name, candidates:cnt, over60, target:t, target_auto:t,
                 over_target:over_t, pct_over:pct, light});
  }
  // טבלת אחוזי חריגה לפי יחידה
  const grp={};
  rows.forEach(c=>{ const g=grp[c.district]||(grp[c.district]={rows:[]}); g.rows.push(c); });
  const districts=Object.keys(grp).map(d=>{
    const rs=grp[d].rows, active=rs.length, avg=Math.round(10*rs.reduce((s,c)=>s+c.days,0)/active)/10;
    const breach={}, in_range={};
    for(let b=1;b<=5;b++){ const t=_target(b), sub=rs.filter(c=>c.range===b), n=sub.length;
      in_range[b]=n; breach[b]= n? Math.round(1000*sub.filter(c=>c.days>t).length/n)/10 : null; }
    return {district:d, active, avg_days:avg, breach, in_range};
  }).sort((a,b)=>b.active-a.active);
  const roleC={}; rows.forEach(c=>{ roleC[c.role]=(roleC[c.role]||0)+1; });
  const by_role=Object.keys(roleC).map(r=>({role:r,count:roleC[r]})).sort((a,b)=>b.count-a.count);
  return { total, ranges, districts, by_role, stuck90,
           trend:_trendMonth(rows,'last'),
           facets:{ roles:_kpiFacet(f,'roles','role'), districts:_kpiFacet(f,'districts','district'),
                    mode:_modeFacet(f) },
           bounds:BOUNDS };
}

// ---------- api_forecast ----------
function computeForecast(f){
  f=f||{};
  const rset=(f.roles!==undefined)?new Set(f.roles):null;
  const dset=(f.districts!==undefined)?new Set(f.districts):null;
  if((rset&&rset.size===0)||(dset&&dset.size===0)) return {weeks:[],targets:[],note:'לא נבחר דבר'};
  const data={};
  META.forecast.forEach(r=>{
    if(rset&&!rset.has(r.role)) return;
    if(dset&&!dset.has(r.district)) return;
    const t=data[r.target]||(data[r.target]={});
    const w=t[r.week]||(t[r.week]={expected:0,pipeline:0});
    w.expected+=r.expected; w.pipeline+=r.pipeline;
  });
  const targets=Object.keys(data).sort().map(t=>{
    const weeks=[]; let tot=0;
    for(let w=1;w<=4;w++){ const cell=data[t][w]||{expected:0,pipeline:0};
      weeks.push({expected:Math.round(cell.expected*10)/10, pipeline:cell.pipeline}); tot+=cell.expected; }
    return {target:t, weeks, total:Math.round(tot*10)/10};
  });
  return {targets};
}

// ---------- api_events ----------
function _evFilter(pool, f){
  f=f||{};
  const rset=(f.roles!==undefined)?new Set(f.roles):null;
  const dset=(f.districts!==undefined)?new Set(f.districts):null;
  const sset=(f.stages!==undefined)?new Set(f.stages):null;
  const from=f.date_from||null, to=f.date_to||null, modeIn=(f.mode==='in');
  return pool.filter(o=>{
    if(rset && !rset.has(o.role)) return false;
    if(dset && !dset.has(o.district)) return false;
    if(sset && !sset.has(o.stage)) return false;
    if(modeIn && !o.inproc) return false;
    if(from && o.date<from) return false;
    if(to && o.date>to) return false;
    return true;
  });
}
function _grp(rows, field){
  const m={};
  rows.forEach(o=>{ const k=o[field]; const g=m[k]||(m[k]={events:0,ppl:new Set()}); g.events++; g.ppl.add(o.cid); });
  return Object.keys(m).map(k=>{ const r={events:m[k].events, people:m[k].ppl.size}; r[field]=k; return r; })
          .sort((a,b)=>b.events-a.events);
}
function _evFacet(pool, f, key, field){ const o=Object.assign({},f); delete o[key];
  const m={}; _evFilter(pool,o).forEach(x=>{ m[x[field]]=(m[x[field]]||0)+1; }); return m; }
function _evModeFacet(pool, f){ const o=Object.assign({},f); delete o.mode; const out={};
  ['in','all'].forEach(mode=>{ out[mode]=_evFilter(pool,Object.assign({},o,{mode})).length; }); return out; }

function computeEvents(kind, f){
  const pool=(kind==='withdrawals')?EV_W:EV_S;
  const label=(kind==='withdrawals')?'מסירי מועמדות':'הפסקות הליך';
  const rows=_evFilter(pool,f);
  const ppl=new Set(); rows.forEach(o=>ppl.add(o.cid));
  const present={}; pool.forEach(o=>present[o.stage]=1);
  const all_stages=META.stages.filter(s=>present[s]);
  let mn=null,mx=null; pool.forEach(o=>{ if(mn===null||o.date<mn)mn=o.date; if(mx===null||o.date>mx)mx=o.date; });
  return { label, total:rows.length, people:ppl.size, dedup:(kind==='withdrawals'),
           no_submission:0, trend:_trendMonth(rows,'date','cid'),
           by_stage:_grp(rows,'stage'), by_district:_grp(rows,'district'),
           by_role:_grp(rows,'role'),
           by_reason:(kind==='stops')?_grp(rows,'reason').slice(0,25):[],
           all_stages,
           facets:{ roles:_evFacet(pool,f,'roles','role'),
                    districts:_evFacet(pool,f,'districts','district'),
                    stages:_evFacet(pool,f,'stages','stage'),
                    mode:_evModeFacet(pool,f) },
           bounds:{min:mn,max:mx} };
}


// ==== קוד התצוגה המקורי (מתוך web_app.py PAGE) ====

const RANGE_COLORS = ["#4F8EF7", "#4FD1A4", "#FFC857", "#F78F4F", "#B57BE0"];
const LIGHT_COLORS = {"ירוק": "#3fae6e", "צהוב": "#d9a441", "אדום": "#cf4d4d", "אין נתונים": "#5b6b8a"};
let F = null, SUPERGROUPS = {}, REPORTS = [];
let EV = { wd:{kind:'withdrawals', data:null}, st:{kind:'stops', data:null} };

function toast(msg, err){ const t=document.getElementById('toast'); t.textContent=msg;
  t.className='show'+(err?' err':''); setTimeout(()=>{t.className=err?'err':'';},4600); }
function closeModal(){ document.getElementById('modal').classList.remove('show'); }
function modal(html){ document.getElementById('modalInner').innerHTML=html;
  document.getElementById('modal').classList.add('show'); }
document.getElementById('modal').onclick = e => { if(e.target.id==='modal') closeModal(); };
const nf = n => (n==null?'':Number(n).toLocaleString());
// ============================================================
// *** בריחה מ-HTML לערכי תכונות. אל תסיר, ואל תבנה data-v בלעדיה. ***
// שמות תפקידים ומחוזות הם עברית עם ראשי תיבות — מג"ב, יס"מ, את"ן,
// 'לשכת מפקד מחוז ת"א' — כלומר הם מכילים גרש כפול. בלי בריחה, התכונה
// data-v="מג"ב" נחתכת בגרש, והדפדפן קורא אותה כ-'מג'. אז המסנן שולח ערך
// שאינו קיים באף שורה, וכל המועמדים של אותו תפקיד/מחוז נעלמים **בשקט** —
// בלי שגיאה, בלי אזהרה, ועם תווית שמבטיחה מספר אחר.
// נמדד ב-15.7: 2,821 מ-7,577 ב'בהליך' ו-10,054 מ-38,773 ב'כולם'.
// זה הבאג שנדב דיווח עליו ("רשום 38,000, בפועל 28,000"). קיים מאז v4.3.
// מבחן שלב 11 אוכף שכל ערך שקיים בנתונים חוזר מהדפדפן זהה לעצמו.
// ============================================================
// ה-\" ב-regex: PAGE אינו raw-string, ולכן \" כאן = \" ב-JS = גרש רגיל.
// סופר גרשיים לא-מוגנים בכל שורה כדי לתפוס מחרוזת שנחתכה בירידת שורה, והוא
// אינו מפרסר regex. בלי הלוכסן הוא מסמן את השורה הזו כשבורה. אל תסיר.
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/\"/g,'&quot;')
                                 .replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

const VIEWS = ['manager','dyn','reports','fc','wd','st'];
function show(v){
  VIEWS.forEach(x=>{ document.getElementById('v-'+x).style.display=(x===v?'':'none');
    const b=document.getElementById('tab-'+x); if(b) b.className=(x===v?'on':''); });
  if(v==='dyn') loadDyn();
  if(v==='fc')  loadForecast();
  if(v==='wd'||v==='st') loadEvents(v);
}

// ---------- מסננים ----------
function picked(g){ return Array.from(document.querySelectorAll(`#fbox input[data-g="${g}"]:checked`)).map(x=>x.dataset.v); }
function filters(){
  if(!F) return {};
  const mode = document.querySelector('#fbox input[name="smode"]:checked')?.value || 'ranges';
  const f = { roles:picked('role'), districts:picked('district'), waiting:picked('wait').map(Number) };
  if(mode==='ranges') f.ranges=picked('range').map(Number); else f.metrics=picked('metric');
  // v4.8 — המתג וטווח התאריכים הגיעו לסרגל העליון (CTL), ואינם עוד בפאנל.
  return ctlFilters('dyn', f);
}
function fstate(){
  const f=filters(), parts=[];
  if(F){
    if(f.roles.length!==F.roles.length) parts.push(`${f.roles.length}/${F.roles.length} תפקידים`);
    if(f.districts.length!==F.districts.length) parts.push(`${f.districts.length}/${F.districts.length} מחוזות`);
  }
  if(f.waiting.length) parts.push(`ממתינים מעל ${Math.min(...f.waiting)} יום`);
  if(f.ranges && f.ranges.length!==5) parts.push(`${f.ranges.length}/5 טווחים`);
  if(f.metrics && f.metrics.length!==11) parts.push(`${f.metrics.length}/11 מדדים`);

  document.getElementById('fstate').textContent = parts.length?('— '+parts.join(' · ')):'— הכול';
}
function chk(g,val,label,cnt,on){
  return `<label class="chk"><input type="checkbox" data-g="${esc(g)}" data-v="${esc(val)}" ${on?'checked':''} onchange="onFilter()">`+
         `<span>${esc(label)}</span>${cnt!==undefined?`<span class="cnt">${nf(cnt)}</span>`:''}</label>`;
}
// כותרת קטגוריה + שלושת הכפתורים (הכל / נקה / איפוס) — חלק ד'
function ghead(name, g, cntId){
  return `<div class="ghead"><span class="gname">${name}</span><span class="gcnt" id="${cntId}"></span></div>
    <div class="gbtns">
      <button class="mini" onclick="setG('${g}',true)">הכל</button>
      <button class="mini" onclick="setG('${g}',false)">נקה</button>
      <button class="mini reset" onclick="resetG('${g}')">איפוס</button>
    </div>`;
}
// ============================================================
// v4.8 — סרגל הבקרה המשותף: מתג האוכלוסייה + טווח התאריכים.
// *** קומפוננטה אחת לשלושת המסכים *** (דינאמי / מסירים / הפסקות).
// נדב ביקש שהמסכים יתנהגו "בדיוק אותו דבר"; הדרך היחידה להבטיח את זה
// לאורך זמן היא קוד אחד, לא שלושה עותקים שמתחילים זהים ונפרדים בשקט.
// ההבדל היחיד בין המסכים הוא במה המתג מסנן ובאיזה תאריך מדובר, וזה
// מגיע כפרמטרים (CTL[scope]).
// ============================================================
const CTL = {
  dyn: { mode:'in',  from:'', to:'', min:null, max:null,
         dateNote:'לפי תאריך הפעולה האחרונה של המועמד — "מי עשה משהו בתקופה".' },
  wd:  { mode:'all', from:'', to:'', min:null, max:null,
         dateNote:'לפי תאריך הסרת המועמדות — האירוע שהמסך סופר.' },
  st:  { mode:'all', from:'', to:'', min:null, max:null,
         dateNote:'לפי תאריך הפסקת ההליך — האירוע שהמסך סופר.' },
};
// טקסטים של המתג. שני הצדדים נקראים אותו דבר בכל המסכים כדי שהמשמעות
// תהיה אחת: 'בהליך' = נמצא בתצלום 'פעילים' האחרון.
const MODE_TXT = {
  dyn: { in:{t:'מועמדים בהליך', d:'נמצאים בדוח פעילים'},
         all:{t:'כולם',          d:'כולל שהופסקו וגויסו'} },
  wd:  { in:{t:'רק מי שבהליך',  d:'הסירו וחזרו להליך'},
         all:{t:'כל ההסרות',     d:'תנועות היסטוריות'} },
  st:  { in:{t:'רק מי שבהליך',  d:'הופסקו וחזרו להליך'},
         all:{t:'כל ההפסקות',    d:'תנועות היסטוריות'} },
};
const DAY = 86400000;
function d2s(d){ return d.toISOString().slice(0,10); }
function s2d(s){ return new Date(s+'T00:00:00Z'); }
function dayIdx(scope, s){ return Math.round((s2d(s)-s2d(CTL[scope].min))/DAY); }
function idxDay(scope, i){ return d2s(new Date(s2d(CTL[scope].min).getTime()+i*DAY)); }
function spanDays(scope){ const c=CTL[scope];
  return c.min&&c.max ? Math.round((s2d(c.max)-s2d(c.min))/DAY) : 0; }

// מרכיב את ה-HTML של הסרגל. נקרא פעם אחת לכל מסך.
function ctlHTML(scope){
  const c=CTL[scope], T=MODE_TXT[scope];
  const st=(F&&F.status)||{};
  const dis = st.loaded ? '' : 'disabled';
  const tip = st.loaded ? '' : `title="דוח 'פעילים' טרם נטען"`;
  return `<div class="ctl">
    <div class="seg-wrap">
      <div class="ctl-lbl">אוכלוסייה${st.loaded?` · נכון ל־${fmtDate(st.snapshot_date)}`:''}</div>
      <div class="seg" id="seg-${scope}">
        <button ${dis} ${tip} class="${c.mode==='in'?'on':''}" onclick="setMode('${scope}','in')">
          <span class="s-t">${T.in.t}</span><span class="s-n" id="mn-${scope}-in">—</span>
          <span class="s-d">${T.in.d}</span></button>
        <button class="${c.mode==='all'?'on':''}" onclick="setMode('${scope}','all')">
          <span class="s-t">${T.all.t}</span><span class="s-n" id="mn-${scope}-all">—</span>
          <span class="s-d">${T.all.d}</span></button>
      </div>
    </div>
    <div class="rng-wrap">
      <div class="ctl-lbl">טווח תאריכים</div>
      <div class="rng-top">
        <input type="date" id="df-${scope}" onchange="onDateBox('${scope}')">
        <span class="sep">←</span>
        <input type="date" id="dt-${scope}" onchange="onDateBox('${scope}')">
        <button class="mini" style="flex:0 0 auto;padding:4px 10px" onclick="resetRange('${scope}')">כל התקופה</button>
        <span class="rng-badge" id="rb-${scope}">—</span>
      </div>
      <div class="slider" id="sl-${scope}">
        <div class="track"></div><div class="fill" id="fl-${scope}"></div>
        <input type="range" id="r1-${scope}" oninput="onSlide('${scope}')">
        <input type="range" id="r2-${scope}" oninput="onSlide('${scope}')">
      </div>
      <div class="rng-ends"><span id="e1-${scope}"></span><span id="e2-${scope}"></span></div>
      <div class="rng-note">${c.dateNote} גרור את הידיות, או בחר תאריך מלוח השנה. ריק = כל התקופה.</div>
    </div>
  </div>`;
}

// מאתחל את הסרגל מגבולות התאריכים שהשרת החזיר. נקרא אחרי כל תשובה, אבל
// מאתחל את המסילה רק בפעם הראשונה — אחרת כל רענון היה מאפס את הגרירה.
function ctlBounds(scope, b){
  const c=CTL[scope];
  if(!b || !b.min || !b.max) return;
  const fresh = (c.min!==b.min || c.max!==b.max);
  c.min=b.min; c.max=b.max;
  const n=spanDays(scope);
  const r1=document.getElementById('r1-'+scope), r2=document.getElementById('r2-'+scope);
  if(!r1||!r2) return;
  [r1,r2].forEach(r=>{ r.min=0; r.max=n; r.step=1; });
  if(fresh || r2.value==='' || +r2.value===0){
    r1.value = c.from ? dayIdx(scope,c.from) : 0;
    r2.value = c.to   ? dayIdx(scope,c.to)   : n;
  }
  document.getElementById('e1-'+scope).textContent=fmtDate(c.min);
  document.getElementById('e2-'+scope).textContent=fmtDate(c.max);
  paintRange(scope);
}

// מצייר את המצב הנוכחי: מילוי המסילה, תיבות התאריך, והתגית.
function paintRange(scope){
  const c=CTL[scope];
  const r1=document.getElementById('r1-'+scope), r2=document.getElementById('r2-'+scope);
  if(!r1||!c.min) return;
  const n=spanDays(scope)||1;
  let a=+r1.value, b=+r2.value; if(a>b){ const t=a; a=b; b=t; }
  const fill=document.getElementById('fl-'+scope);
  // RTL: אחוז 0 הוא הקצה הימני (התאריך המוקדם), ולכן right ולא left.
  fill.style.right=(100*a/n)+'%'; fill.style.width=(100*(b-a)/n)+'%';
  const from=idxDay(scope,a), to=idxDay(scope,b);
  document.getElementById('df-'+scope).value=from;
  document.getElementById('dt-'+scope).value=to;
  const full=(a===0&&b===n);
  document.getElementById('rb-'+scope).textContent =
    full ? `כל התקופה · ${nf(n+1)} ימים` : `${fmtDate(from)} → ${fmtDate(to)} · ${nf(b-a+1)} ימים`;
  // ריק = ללא הגבלה. חשוב: טווח 'מלא' *אינו* זהה לריק — הוא עדיין דורש
  // תאריך פעולה, ולכן מסלק את מי שאין לו אחד (9,483 מועמדים בדשבורד).
  c.from = full ? '' : from;
  c.to   = full ? '' : to;
}
function onSlide(scope){
  const r1=document.getElementById('r1-'+scope), r2=document.getElementById('r2-'+scope);
  if(+r1.value > +r2.value){ const t=r1.value; r1.value=r2.value; r2.value=t; }
  paintRange(scope); ctlReload(scope);
}
function onDateBox(scope){
  const c=CTL[scope];
  const f=document.getElementById('df-'+scope).value, t=document.getElementById('dt-'+scope).value;
  if(!f||!t) return;
  const n=spanDays(scope);
  const cl=x=>Math.max(0,Math.min(n,x));
  document.getElementById('r1-'+scope).value=cl(dayIdx(scope,f));
  document.getElementById('r2-'+scope).value=cl(dayIdx(scope,t));
  onSlide(scope);
}
function resetRange(scope){
  const n=spanDays(scope);
  document.getElementById('r1-'+scope).value=0;
  document.getElementById('r2-'+scope).value=n;
  onSlide(scope);
}
function setMode(scope, m){
  CTL[scope].mode=m;
  document.querySelectorAll(`#seg-${scope} button`).forEach((b,i)=>
    b.className = ((i===0?'in':'all')===m) ? 'on' : '');
  ctlReload(scope);
}
// מעדכן את המספרים שעל שני צדי המתג מהספירה המפולחת שהשרת החזיר.
// *** זה התיקון לבאג שנדב דיווח עליו ***: קודם המספר הגיע מ-api_filters
// פעם אחת בטעינה ולא התעדכן, ולכן ליד 'כולם' היה כתוב 38,773 בזמן
// שהלחיצה החזירה 27,448 (כי מסנן ימי-המתנה היה פעיל).
function paintModeCounts(scope, facets){
  const m=(facets||{}).mode; if(!m) return;
  ['in','all'].forEach(k=>{
    const el=document.getElementById(`mn-${scope}-${k}`);
    if(el) el.textContent=nf(m[k]);
  });
}
function ctlReload(scope){
  if(scope==='dyn') onFilter(); else evReload(scope);
}
// מזריק את מצב הסרגל לאובייקט המסננים שנשלח לשרת.
function ctlFilters(scope, f){
  const c=CTL[scope];
  f.mode=c.mode;
  if(c.from) f.date_from=c.from;
  if(c.to)   f.date_to=c.to;
  return f;
}

// v4.7 — רצועת 'תאריך עדכון' לכל דוח. התאריך הוא תאריך *הפקת הקובץ* (משמו),
// ולא מועד הטעינה: קובץ בן שבוע שנטען היום מעודכן לשבוע שעבר, וזה מה שחשוב.
// הדוח הישן ביותר מסומן, כי תמונת המאגר טובה רק כמו הקובץ המפגר שבה.
function fmtDate(d){ if(!d) return '—'; const [y,m,dd]=d.split('-'); return `${+dd}.${+m}.${y}`; }
async function loadUpdates(){
  const u = await (await fetch('/api/file_updates')).json();
  const dates = u.map(x=>x.file_date).filter(Boolean);
  const oldest = dates.length ? dates.reduce((a,b)=>a<b?a:b) : null;
  document.getElementById('upd').innerHTML =
    '<span style="align-self:center">תאריך עדכון:</span>' +
    u.map(x=>{
      const cls = !x.file_date ? 'u miss' : (x.file_date===oldest && dates.length>1 ? 'u stale' : 'u');
      const t = x.file_date ? `נטען: ${x.source_file}` : 'הדוח טרם נטען';
      return `<span class="${cls}" title="${t}">${x.label} <b>${fmtDate(x.file_date)}</b></span>`;
    }).join('');
}
async function loadFilters(){
  F = await (await fetch('/api/filters')).json();
  SUPERGROUPS = F.supergroups||{};
  let h='';
  h += `<div class="fgrp">${ghead('תפקיד','role','c-role')}
        <div class="gbtns" style="padding-top:0">
          <button class="mini" onclick="quick('שטח')">רק שטח</button>
          <button class="mini" onclick="quick('מנהלה')">רק מנהלה</button>
        </div>
        <div class="scroll">${F.roles.map(r=>chk('role',r.name,r.name,r.active,true)).join('')}</div></div>`;
  h += `<div class="fgrp">${ghead('מחוז','district','c-district')}
        <div class="scroll">${F.districts.map(d=>chk('district',d.name,d.name,d.active,true)).join('')}</div></div>`;
  h += `<div class="fgrp">${ghead('ימי המתנה','wait','c-wait')}
        <div class="scroll">${F.waiting.map(w=>chk('wait',w,'מעל '+w+' יום',undefined,false)).join('')}
        <div class="note" style="padding:4px 0 2px">התיבות מקוננות — הסינון בפועל הוא הסף הנמוך שנבחר.</div></div></div>`;
  h += `<div class="fgrp">${ghead('שלב בהליך','stage','c-stage')}
        <div style="padding:0 12px">
          <label class="chk"><input type="radio" name="smode" value="ranges" checked onchange="modeSwitch()"><span>5 טווחי-על</span></label>
          <label class="chk"><input type="radio" name="smode" value="metrics" onchange="modeSwitch()"><span>11 מדדים פרטניים</span></label>
        </div>
        <div id="stageList" class="scroll" style="border-top:1px solid #26314e; margin-top:5px; padding-top:5px"></div></div>`;
  document.getElementById('fbox').innerHTML = h;
  // הסרגל נבנה כאן ולא ב-HTML הסטטי: הוא צריך את F.status (תאריך התצלום,
  // והאם הדוח בכלל נטען) כדי לדעת אם 'בהליך' זמין.
  document.getElementById('ctl-dyn').innerHTML = ctlHTML('dyn');
  if(!((F.status||{}).loaded)) CTL.dyn.mode='all';   // אין דוח -> אין 'בהליך' אמיתי
  modeSwitch();
}
function modeSwitch(){
  const mode=document.querySelector('#fbox input[name="smode"]:checked').value;
  document.getElementById('stageList').innerHTML = (mode==='ranges')
    ? F.ranges.map(r=>chk('range',r.no,`טווח ${r.no}: ${r.name}`,undefined,true)).join('')
    : F.metrics.map(m=>chk('metric',m.metric,`${m.metric}. ${m.heb}`,undefined,true)).join('');
  onFilter();
}
function setG(g,val){
  if(g==='stage'){ ['range','metric'].forEach(x=>setG(x,val)); return; }
  document.querySelectorAll(`#fbox input[data-g="${g}"]`).forEach(x=>x.checked=val);
  onFilter();
}
// איפוס = חזרה לברירת המחדל של אותה קטגוריה (הכול מסומן; ימי המתנה — כלום)
function resetG(g){
  if(g==='wait') return setG('wait',false);
  if(g==='stage'){ document.querySelector('#fbox input[name="smode"][value="ranges"]').checked=true; return modeSwitch(); }
  setG(g,true);
}
function quick(kind){
  const set=new Set(SUPERGROUPS[kind]||[]);
  document.querySelectorAll('#fbox input[data-g="role"]').forEach(x=>x.checked=set.has(x.dataset.v));
  onFilter();
}
function gcounts(){
  [['role','c-role'],['district','c-district'],['wait','c-wait']].forEach(([g,id])=>{
    const all=document.querySelectorAll(`#fbox input[data-g="${g}"]`).length;
    const on=document.querySelectorAll(`#fbox input[data-g="${g}"]:checked`).length;
    const el=document.getElementById(id); if(el) el.textContent=`${on}/${all}`;
  });
  const m=document.querySelector('#fbox input[name="smode"]:checked')?.value;
  const g=(m==='ranges')?'range':'metric';
  const all=document.querySelectorAll(`#fbox input[data-g="${g}"]`).length;
  const on=document.querySelectorAll(`#fbox input[data-g="${g}"]:checked`).length;
  const el=document.getElementById('c-stage'); if(el) el.textContent=`${on}/${all}`;
}
let timer=null;
function onFilter(){ fstate(); gcounts(); clearTimeout(timer); timer=setTimeout(loadDyn,120); }

// ---------- כרטיסים ----------
function tiles(k){
  let h=`<div class="tile total"><div class="val">${nf(k.total)}</div>
    <div class="lbl">מועמדים בהליך פעיל</div>
    <div class="foot">מתוכם ${nf(k.stuck90)} ממתינים מעל 90 יום</div></div>`;
  k.ranges.forEach((g,i)=>{
    const c=RANGE_COLORS[i%RANGE_COLORS.length], lc=LIGHT_COLORS[g.light]||'#5b6b8a';
    const sla = g.pct_over===null?'' :
      `<div class="sla" style="background:${lc}22;color:${lc}">
         <span class="dot" style="background:${lc}"></span>${g.light} · ${g.pct_over}% מעל ${g.target} יום</div>`;
    h+=`<div class="tile" style="border-top:3px solid ${c}">
      <div class="val">${nf(g.candidates)}</div>
      <div class="lbl">טווח ${g.no}: ${g.name}</div>
      <div class="foot">מעל 60 יום: ${nf(g.over60)}</div>${sla}</div>`;
  });
  return h;
}
// v5.1 — אחוז החריגות לכל יחידה, בכל אחד מ-5 השלבים.
// אותם ספי צבע כמו נורות ה-SLA בראש המסך (ירוק <10% · צהוב 10%-25% ·
// אדום >25%), כי זה אותו מדד — רק פרוס לפי יחידה.
function breachColor(pct){
  if(pct===null||pct===undefined) return '#6f83a6';
  if(pct < 10)  return LIGHT_COLORS['ירוק'];
  if(pct <= 25) return LIGHT_COLORS['צהוב'];
  return LIGHT_COLORS['אדום'];
}
function distTable(rows, ranges){
  const rs = ranges||[];
  // הכותרת נושאת את X של כל טווח. בלעדיו '27%' הוא מספר בלי אמת מידה.
  let d='<thead><tr><th>יחידה</th><th>פעילים</th><th>ממוצע ימים</th>';
  rs.forEach(r=>{ d+=`<th class="num rngh" title="${esc(r.name)} — חריגה מעל ${r.target} ימים">`+
    `<div class="rngn">${esc(r.name)}</div>`+
    `<div style="font-size:9px;color:#6f83a6;font-weight:400">מעל ${r.target} י'</div></th>`; });
  d+='</tr></thead><tbody>';
  rows.forEach(x=>{
    d+=`<tr><td>${esc(x.district)}</td><td class="num">${nf(x.active)}</td><td class="num">${x.avg_days??''}</td>`;
    rs.forEach(r=>{
      const p=(x.breach||{})[r.no], n=(x.in_range||{})[r.no]||0;
      // '—' = אין ממתינים בטווח הזה ביחידה. זה אינו 0% — אפס-מתוך-אפס אינו הישג.
      // כמות הממתינים מוצגת **בכל תא**, לא רק בהצפה: 13% מהתאים נשענים על
      // 1-2 מועמדים, ו-'100%' אדום שהוא בעצם אדם אחד מטעה על מסך מנהלים.
      // הצגת ה-n לצד האחוז פותרת בלי להסתיר נתון ובלי סף שרירותי.
      d+= (p===null||p===undefined)
        ? `<td class="num" style="color:#4a5a78" title="אין ממתינים בשלב זה">—</td>`
        : `<td class="num" style="color:${breachColor(p)};font-weight:600" title="${nf(n)} ממתינים בשלב">`+
          `${p}%<span style="font-size:9px;color:#5b6b8a;font-weight:400"> (${nf(n)})</span></td>`;
    });
    d+='</tr>';
  });
  return d+'</tbody>';
}
// ---- גרפי עמודות: חלוקה למקצועות / אגפים / טווחי זמן (חלק ה', נדב) ----
// מוצגים זה מעל זה ומתעדכנים בכל פעולה. אותה קומפוננטה בכל המסכים.
function barCard(title, rows, labelKey, valKey){
  const max=Math.max(1, ...rows.map(r=>+r[valKey]||0));
  let h=`<div class="card barcard"><div class="bartitle">${esc(title)}</div><table class="t bars"><tbody>`;
  rows.forEach((r,i)=>{ const v=+r[valKey]||0, c=RANGE_COLORS[i%RANGE_COLORS.length];
    h+=`<tr><td class="blab" title="${esc(String(r[labelKey]))}">${esc(String(r[labelKey]))}</td>`+
       `<td class="bwrap"><div class="bbar" style="width:${(100*v/max).toFixed(1)}%;background:${c}"></div></td>`+
       `<td class="num bval">${nf(v)}</td></tr>`; });
  return h+'</tbody></table></div>';
}
// ---- גרף מגמה לפי תאריכים (קו/שטח) — "שינוי לאורך זמן", לא עמודות (נדב) ----
// ציר הזמן RTL כמו מחוון הטווח: המוקדם מימין, המאוחר משמאל. x ממופה לפי
// התאריך בפועל ולכן שבוע חסר נשמר כרווח אמיתי. הסדרה כבר מסוננת (computeKpi/
// computeEvents) ולכן הגרף זז עם המסננים/המתג/הטווח בדיוק כמו העמודות.
function niceStep(x){ if(x<=0) return 1; const p=Math.pow(10,Math.floor(Math.log10(x)));
  const f=x/p; return (f<=1?1:f<=2?2:f<=5?5:10)*p; }
function fmtMonth(iso){ if(!iso) return ''; const [y,m]=iso.split('-'); return `${+m}.${y}`; }
function trendCard(title, points, opts){
  opts=opts||{}; const valKey=opts.valKey||'count', color=opts.color||RANGE_COLORS[0];
  const pts=(points||[]).filter(p=>p&&p.period&&p[valKey]!=null)
    .map(p=>({t:Date.parse(p.period+'T00:00:00Z'), v:+p[valKey]||0, ppl:p.people, mo:p.period}));
  if(pts.length<2){
    return `<div class="card trendcard"><div class="bartitle">${esc(title)}</div>
      <div class="tnote">אין מספיק נתונים להצגת מגמה (נדרשים שני חודשים לפחות).</div></div>`;
  }
  const W=780,H=230,PL=44,PR=14,PT=16,PB=30;
  const minT=Math.min(...pts.map(p=>p.t)), maxT=Math.max(...pts.map(p=>p.t));
  const maxV=Math.max(1, ...pts.map(p=>p.v));
  const step=niceStep(maxV/4), top=Math.max(step, Math.ceil(maxV/step)*step);
  const X=t=> PL + (W-PL-PR)*(maxT-t)/((maxT-minT)||1);   // RTL: המוקדם מימין
  const Y=v=> PT + (H-PT-PB)*(1 - v/top);
  let grid='';
  for(let g=0; g<=top+0.001; g+=step){ const y=Y(g).toFixed(1);
    grid+=`<line x1="${PL}" y1="${y}" x2="${W-PR}" y2="${y}" class="tgrid"/>`
        + `<text x="${PL-6}" y="${(+y+3).toFixed(1)}" class="tylab">${nf(g)}</text>`; }
  // תווית לכל חודש (כל נקודה היא חודש). דילוג אוטומטי אם צפוף: מציגים כל
  // חודש כשיש עד 14 נקודות, אחרת כל חודש שני.
  let xlab='', gap=pts.length>14?2:1;
  pts.forEach((p,i)=>{ if(i%gap) return;
    xlab+=`<text x="${X(p.t).toFixed(1)}" y="${H-8}" class="txlab">${fmtMonth(p.mo)}</text>`; });
  const line=pts.map((p,i)=>`${i?'L':'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ');
  const area=`M${X(pts[0].t).toFixed(1)},${(H-PB).toFixed(1)} `
    + pts.map(p=>`L${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')
    + ` L${X(pts[pts.length-1].t).toFixed(1)},${(H-PB).toFixed(1)} Z`;
  const dots=pts.map(p=>{ const tip=fmtMonth(p.mo)+' — '+nf(p.v)+(p.ppl!==undefined?' ('+nf(p.ppl)+' מועמדים)':'');
    return `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="${color}"><title>${esc(tip)}</title></circle>`; }).join('');
  const gid='tg'+color.replace('#','');
  return `<div class="card trendcard"><div class="bartitle">${esc(title)}</div>
    <svg class="tsvg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.32"/>
        <stop offset="1" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>
      ${dots}${xlab}
    </svg>
    <div class="tnote">ציר הזמן RTL — המוקדם מימין, המאוחר משמאל. מעבר עם העכבר על נקודה מציג את פירוט החודש.</div>
  </div>`;
}
function kpiBars(k){
  const byUnit=(k.districts||[]).map(x=>({name:x.district,count:x.active}));
  const byRange=(k.ranges||[]).map(x=>({name:x.name,count:x.candidates}));
  return `<div class="barstack">
    ${barCard('חלוקה למקצועות', k.by_role||[], 'role','count')}
    ${barCard('חלוקה לאגפים', byUnit, 'name','count')}
    ${barCard('חלוקה לטווחי זמן', byRange, 'name','count')}</div>
    ${trendCard('פעילות מועמדים לאורך זמן (חודשי)', k.trend, {valKey:'count'})}`;
}
function evBars(d){
  const color = d.dedup ? RANGE_COLORS[3] : RANGE_COLORS[2];  // מסירים כתום · הפסקות צהוב
  return `<div class="barstack">
    ${barCard('חלוקה למקצועות', d.by_role||[], 'role','events')}
    ${barCard('חלוקה לאגפים', d.by_district||[], 'district','events')}
    ${barCard('חלוקה לשלב באירוע', d.by_stage||[], 'stage','events')}</div>
    ${trendCard((d.label||'אירועים')+' לאורך זמן (חודשי)', d.trend, {valKey:'count', color})}`;
}
async function loadManager(){
  const k=await (await fetch('/api/kpi',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filters:{}})})).json();
  document.getElementById('mgrKpis').innerHTML=tiles(k);
  document.getElementById('mgrBars').innerHTML=kpiBars(k);
  document.getElementById('mgrDist').innerHTML=distTable(k.districts, k.ranges);
  // 'כרגע' חייב להיות מלווה בתאריך: המסך מציג את דוח 'פעילים', וזה תצלום.
  // בלי התאריך המשתמש קורא תמונה של אתמול כאילו היא של היום.
  const st=(F&&F.status)||{};
  document.getElementById('mgrSub').textContent = st.loaded
    ? `— לפי דוח 'פעילים', נכון ל־${fmtDate(st.snapshot_date)} · ללא סינון`
    : '— ללא סינון, תמונת המאגר המלאה';
}
// מעדכן את המספר שליד כל תיבה לספירה המפולחת. בלי זה התוויות נשארות על
// התמונה הלא-מסוננת וסותרות את המסך (היה: 'סייר 187' כשבמחוז הנבחר יש 6).
function dynFacets(facets){
  const map = {role:facets.roles, district:facets.districts};
  for(const [g,counts] of Object.entries(map)){
    document.querySelectorAll(`#fbox input[data-g="${g}"]`).forEach(inp=>{
      const span = inp.parentElement.querySelector('.cnt');
      if(span) span.textContent = (counts[inp.dataset.v] || 0).toLocaleString();
    });
  }
}
async function loadDyn(){
  const k=await (await fetch('/api/kpi',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filters:filters()})})).json();
  document.getElementById('dynKpis').innerHTML=tiles(k);
  document.getElementById('dynBars').innerHTML=kpiBars(k);
  document.getElementById('dynDist').innerHTML=distTable(k.districts, k.ranges);
  if(k.facets){ dynFacets(k.facets); paintModeCounts('dyn', k.facets); }
  ctlBounds('dyn', k.bounds);
}

// ---------- צפי ----------
async function loadForecast(){
  const r=await (await fetch('/api/forecast',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({filters:{}})})).json();
  if(!r.targets||!r.targets.length){ document.getElementById('fcBox').innerHTML='<div class="card">אין נתונים.</div>'; return; }
  let h='';
  r.targets.forEach(t=>{
    h+=`<h2>צפי ל${t.target} — סה"כ בתוחלת ${nf(t.total)} ב-4 שבועות</h2><div class="kpis">`;
    t.weeks.forEach((w,i)=>{ const c=RANGE_COLORS[i%RANGE_COLORS.length];
      h+=`<div class="tile" style="border-top:3px solid ${c}">
        <div class="val">${nf(w.expected)}</div><div class="lbl">שבוע ${i+1}</div>
        <div class="foot">${nf(w.pipeline)} מועמדים בצנרת לשבוע זה</div></div>`; });
    h+='</div>';
  });
  document.getElementById('fcBox').innerHTML=h;
}

// ---------- מסירי מועמדות / הפסקות ----------
function evFilters(v){
  const roles=Array.from(document.querySelectorAll(`#${v}Host input[data-g="role"]:checked`)).map(x=>x.dataset.v);
  const dist =Array.from(document.querySelectorAll(`#${v}Host input[data-g="district"]:checked`)).map(x=>x.dataset.v);
  const st   =Array.from(document.querySelectorAll(`#${v}Host input[data-g="stage"]:checked`)).map(x=>x.dataset.v);
  const out={};
  if(document.querySelector(`#${v}Host input[data-g="role"]`)) out.roles=roles;
  if(document.querySelector(`#${v}Host input[data-g="district"]`)) out.districts=dist;
  if(document.querySelector(`#${v}Host input[data-g="stage"]`)) out.stages=st;
  // v4.8 — המתג וטווח התאריכים מגיעים מהסרגל המשותף, בדיוק כמו בדינאמי.
  return ctlFilters(v, out);
}
function evSetG(v,g,val){ document.querySelectorAll(`#${v}Host input[data-g="${g}"]`).forEach(x=>x.checked=val); evReload(v); }
function evChk(g,val,label,cnt){
  return `<label class="chk"><input type="checkbox" data-g="${esc(g)}" data-v="${esc(val)}" checked onchange="evReload('${CUR_EV}')">
          <span>${esc(label)}</span>${cnt!==undefined?`<span class="cnt">${nf(cnt)}</span>`:''}</label>`;
}
let CUR_EV='wd';
function evHead(v,name,g){
  return `<div class="ghead"><span class="gname">${name}</span></div>
    <div class="gbtns">
      <button class="mini" onclick="evSetG('${v}','${g}',true)">הכל</button>
      <button class="mini" onclick="evSetG('${v}','${g}',false)">נקה</button>
      <button class="mini reset" onclick="evSetG('${v}','${g}',true)">איפוס</button>
    </div>`;
}
async function loadEvents(v){
  CUR_EV=v;
  const kind=EV[v].kind;
  const host=document.getElementById(v+'Host');
  if(!EV[v].built){
    const d=await (await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind, filters:{}})})).json();
    EV[v].all=d;
    const dedupNote = d.dedup
      ? `<b>שורה אחת לכל מועמד.</b> נלקחה ההסרה הראשונה שלו בלבד — ולכן מספר האירועים שווה למספר המועמדים.`
      : `<b>שורה לכל אירוע הפסקה.</b> למועמד יכולות להיות כמה הפסקות, ולכן מוצגת בנפרד כמות המועמדים החד-ערכית.`;
    // v4.9: ספירת 'ללא רשומת הגשה' ירדה מהבאנר. נדב: "בלי להציף את זה ולרשום" —
    // עמודת התאריך בדוח נושאת כותרת 'הגשת מועמדות/בדיקת קבצים', וזה מספיק.
    const noSub = '';
    host.innerHTML = `
      <div id="ctl-${v}"></div>
      <h2>${d.label} — מסננים נוספים</h2>
      <div class="warn">${dedupNote}<br>
        <b>השלב</b> הוא זה שבו המועמד היה <b>בעת האירוע</b> — לא השלב הנוכחי שלו.<br>
        <b>מועמד אינו חייב להגיש מועמדות כדי להיכנס לדוח, ואינו חייב לעבור את כל השלבים.</b>
        לא כל המועמדים מבצעים את אותן פעולות: חלק נכנסים להליך בלי הגשה, וחלק החלו בשנה קודמת.
        מי שיש לו פעילות או הפסקת הליך נספר כאן — גם בלי הגשה.${noSub}</div>
      <div class="fbox">
        <div class="fgrp">${evHead(v,'תפקיד','role')}<div class="scroll" id="${v}Role"></div></div>
        <div class="fgrp">${evHead(v,'מחוז','district')}<div class="scroll" id="${v}Dist"></div></div>
        <div class="fgrp">${evHead(v,'שלב באירוע','stage')}<div class="scroll" id="${v}Stage"></div></div>
      </div>
      <h2>מצב לפי הסינון</h2>
      <div class="kpis" id="${v}Kpis"></div>
      <div style="margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; align-items:center">
        <span class="act-btn dis" title="זמין בגרסת השרת המלאה">⭳ ייצוא שמי</span>
        <span class="act-btn dis" title="זמין בגרסת השרת המלאה">⭳ ייצוא מלא (שמי + דשבורד)</span>
      </div>
      <div id="${v}Bars"></div>
      <div class="row2" style="margin-top:16px">
        <div class="card" style="flex:1 1 300px"><h2 style="margin-top:0">לפי שלב</h2><table class="t" id="${v}TabStage"></table></div>
        <div class="card" style="flex:1 1 300px"><h2 style="margin-top:0">לפי מחוז</h2><table class="t" id="${v}TabDist"></table></div>
        <div class="card" style="flex:1 1 300px"><h2 style="margin-top:0">${kind==='stops'?'לפי סיבה':'לפי תפקיד'}</h2><table class="t" id="${v}TabX"></table></div>
      </div>`;
    // התוויות נבנות פעם אחת; המספרים שבתוכן מתעדכנים בכל evReload (facets).
    document.getElementById(v+'Role').innerHTML  = d.by_role.map(r=>evChk('role',r.role,r.role,r.events)).join('');
    document.getElementById(v+'Dist').innerHTML  = d.by_district.map(r=>evChk('district',r.district,r.district,r.events)).join('');
    document.getElementById(v+'Stage').innerHTML = d.all_stages.map(s=>evChk('stage',s,s,0)).join('');
    // אותו סרגל בדיוק כמו בדשבורד הדינאמי — אותה קומפוננטה, אותה התנהגות.
    document.getElementById('ctl-'+v).innerHTML = ctlHTML(v);
    ctlBounds(v, d.bounds);
    EV[v].built=true;
  }
  evReload(v);
}
// מעדכן את המספר שליד כל תיבה לספירה המפולחת שחזרה מהשרת.
// בלי זה התוויות נשארות על התמונה הלא-מסוננת וסותרות את מה שעל המסך.
function evFacets(v, facets){
  const map = {role:facets.roles, district:facets.districts, stage:facets.stages};
  for(const [g, counts] of Object.entries(map)){
    document.querySelectorAll(`#${v}Host input[data-g="${g}"]`).forEach(inp=>{
      const span = inp.parentElement.querySelector('.cnt');
      if(span) span.textContent = (counts[inp.dataset.v] || 0).toLocaleString();
    });
  }
}
async function evReload(v){
  const kind=EV[v].kind;
  const d=await (await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({kind, filters:evFilters(v)})})).json();
  EV[v].data=d;
  if(d.facets){ evFacets(v, d.facets); paintModeCounts(v, d.facets); }
  let h=`<div class="tile total"><div class="val">${nf(d.total)}</div>
    <div class="lbl">${d.dedup?'מועמדים שהסירו מועמדות':'אירועי הפסקת הליך'}</div>
    <div class="foot">${d.dedup?'שורה אחת לכל מועמד':'מועמדים חד-ערכיים: <b>'+nf(d.people)+'</b>'}</div></div>`;
  d.by_stage.slice(0,5).forEach((r,i)=>{ const c=RANGE_COLORS[i%RANGE_COLORS.length];
    const pct = d.total? Math.round(100*r.events/d.total):0;
    h+=`<div class="tile" style="border-top:3px solid ${c}"><div class="val">${nf(r.events)}</div>
      <div class="lbl">${r.stage}</div>
      <div class="foot">${pct}% מהאירועים${d.dedup?'':' · '+nf(r.people)+' מועמדים'}</div>
      <div class="bar"><i style="width:${pct}%;background:${c}"></i></div></div>`; });
  document.getElementById(v+'Kpis').innerHTML=h;
  document.getElementById(v+'Bars').innerHTML=evBars(d);
  const tab=(rows,key,label)=>{
    let t=`<thead><tr><th>${label}</th><th>אירועים</th>${d.dedup?'':'<th>מועמדים</th>'}</tr></thead><tbody>`;
    rows.forEach(r=>{ t+=`<tr><td>${r[key]}</td><td class="num">${nf(r.events)}</td>${d.dedup?'':`<td class="num">${nf(r.people)}</td>`}</tr>`; });
    return t+'</tbody>';
  };
  document.getElementById(v+'TabStage').innerHTML=tab(d.by_stage,'stage','שלב');
  document.getElementById(v+'TabDist').innerHTML=tab(d.by_district,'district','מחוז');
  document.getElementById(v+'TabX').innerHTML = (kind==='stops')
    ? tab(d.by_reason,'reason','סיבה') : tab(d.by_role,'role','תפקיד');
}
async function expEvents(btn,v,full){
  btn.disabled=true; const old=btn.textContent; btn.innerHTML='מפיק…<span class="spin"></span>';
  try{
    const res=await (await fetch('/api/export_events',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:EV[v].kind, filters:evFilters(v), full})})).json();
    if(res.ok) toast(`✔ נוצר: ${res.file} (${nf(res.rows)} שורות) → תוצאות/`);
    else toast('✖ שגיאה: '+(res.error||'לא ידוע'), true);
  }catch(e){ toast('✖ שגיאת רשת: '+e, true); }
  btn.textContent=old; btn.disabled=false;
}

// ---------- דוחות ----------
async function loadReports(){
  REPORTS=await (await fetch('/api/reports')).json();
  const g=document.getElementById('grid'); g.innerHTML='';
  REPORTS.forEach(rep=>{ const b=document.createElement('button'); b.className='rep';
    b.innerHTML=`<div class="t">${rep.name}</div><div class="d">${rep.desc}</div>`;
    b.classList.add('rep-dis'); b.title='זמין בגרסת השרת המלאה'; b.onclick=()=>toast('הפקת דוחות זמינה בגרסת השרת המלאה'); g.appendChild(b); });
}
async function runReport(rep, btn){
  // דוח שדורש מחוז: בודקים לפני השליחה כדי לתת הודעה ברורה במקום קובץ מטעה.
  if(rep.requires_district){
    const f=filters();
    if(!f.districts.length || f.districts.length>=F.districts.length){
      modal(`<h3>צריך לבחור מחוז</h3>
        <div class="note" style="font-size:13px">הדוח "${rep.name}" מופק עבור מחוז מסוים.
        עבור ל<b>דשבורד דינאמי</b>, בחר בקטגוריית <b>מחוז</b> את המחוז (או כמה) שמעניין אותך — ולא את כולם — וחזור לכאן.</div>
        <div style="margin-top:16px; display:flex; gap:8px">
          <button class="act-btn" onclick="closeModal();show('dyn')">פתח את המסננים</button>
          <button class="act-btn ghost" onclick="closeModal()">סגור</button></div>`);
      return;
    }
  }
  btn.disabled=true; const el=btn.querySelector('.t'), old=el.textContent; el.textContent='מפיק…';
  try{
    const res=await (await fetch('/api/report',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:rep.name, filters:filters(), all_districts:F?F.districts.map(d=>d.name):null})})).json();
    if(res.ok) toast(`✔ נוצר: ${res.file} (${nf(res.rows)} שורות${res.filtered?' · מסונן':''}) → תוצאות/`);
    else toast('✖ '+(res.error||'שגיאה לא ידועה'), true);
  }catch(e){ toast('✖ שגיאת רשת: '+e, true); }
  el.textContent=old; btn.disabled=false;
}
async function exportView(btn, unfiltered, full){
  btn.disabled=true; const old=btn.textContent; btn.innerHTML='מפיק…<span class="spin"></span>';
  try{
    const res=await (await fetch('/api/export_view',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({filters: unfiltered?{}:filters(), full})})).json();
    if(res.ok) toast(`✔ נוצר: ${res.file} (${nf(res.rows)} מועמדים) → תוצאות/`);
    else toast('✖ שגיאה: '+(res.error||'לא ידוע'), true);
  }catch(e){ toast('✖ שגיאת רשת: '+e, true); }
  btn.textContent=old; btn.disabled=false;
}

// ---------- טעינת נתונים ----------
async function doIngest(btn){
  // שים לב: PAGE היא מחרוזת פייתון רגילה (לא raw), ולכן כל רצף בריחה כאן
  // מפוענח פעמיים — פעם ע"י פייתון ופעם ע"י JS. ירידת שורה במחרוזת JS חייבת
  // להיכתב כלוכסן כפול, אחרת פייתון הופך אותה לשורה אמיתית וכל הסקריפט נופל.
  if(!confirm('לטעון את האקסלים מתיקיית "אקסלים_לטעינה" ולרענן את כל המדדים?\n\nזו הפעולה היחידה שכותבת למאגר. הקבצים שייקלטו יועברו לתיקיית "אקסלים_שנטענו".')) return;
  btn.disabled=true; const old=btn.textContent; btn.innerHTML='טוען…<span class="spin"></span>';
  modal('<h3>טוען נתונים…</h3><div class="note">קליטת האקסלים ורענון השרשרת. על מאגר גדול זה יכול לקחת דקה או שתיים — אל תסגור את החלון.</div>');
  try{
    const res=await (await fetch('/api/ingest',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).json();
    let h;
    if(res.ok){
      h='<h3>✔ הטעינה הושלמה</h3><table class="t"><tbody>';
      for(const [k,v] of Object.entries(res.summary)) h+=`<tr><td>${k}</td><td class="num">${nf(v)}</td></tr>`;
      h+='</tbody></table>';
      (res.steps||[]).forEach(s=>{ if(s.out) h+=`<div class="note" style="margin-top:8px"><b>${s.step}:</b></div><pre>${s.out}</pre>`; });
      toast('✔ הנתונים נטענו ורועננו');
    } else {
      h=`<h3>✖ הטעינה נכשלה</h3><div class="note">${res.error||''}</div>`;
      (res.steps||[]).forEach(s=>{ if(s.err||s.out) h+=`<div class="note" style="margin-top:8px"><b>${s.step}</b> — ${s.ok?'עבר':'נכשל'}:</div><pre>${(s.err||s.out)}</pre>`; });
      toast('✖ הטעינה נכשלה', true);
    }
    h+='<div style="margin-top:16px"><button class="act-btn" onclick="closeModal()">סגור</button></div>';
    modal(h);
    if(res.ok){ EV.wd.built=EV.st.built=false; await loadFilters(); loadUpdates(); loadManager(); }
  }catch(e){
    modal(`<h3>✖ שגיאת רשת</h3><pre>${e}</pre><div style="margin-top:16px">
      <button class="act-btn" onclick="closeModal()">סגור</button></div>`);
  }
  btn.textContent=old; btn.disabled=false;
}



// ---------- צפי הדגמה: שורה לכל שלב, צמיחה חזויה 10%-15% (בלי קשר לנתוני אמת) ----------
function loadForecast(){
  const stages=META.forecast_stages, g=META.forecast_growth;
  const base={}; META.forecast_base.forEach(r=>{ base[r.stage]=(base[r.stage]||0)+r.count; });
  const warn=document.querySelector('#v-fc .warn');
  if(warn) warn.innerHTML='<b>צפי הדגמה.</b> המודל מציג צמיחה חזויה של 10%–15% בכל שלב לאורך 4 שבועות — בלי קשר לנתוני אמת. הערך הוא תוחלת.';
  let h='<div class="card"><table class="t"><thead><tr><th>שלב</th><th class="num">נוכחי</th>'+
        '<th class="num">שבוע 1</th><th class="num">שבוע 2</th><th class="num">שבוע 3</th><th class="num">שבוע 4</th>'+
        '<th class="num">צפי עלייה</th></tr></thead><tbody>';
  stages.forEach((s,i)=>{
    const now=base[s]||0, gr=g[s]||0.12, c=RANGE_COLORS[i%RANGE_COLORS.length];
    // עלייה חזויה של gr (10%-15%) על פני 4 שבועות — רמפה לינארית עד היעד.
    let cells='';
    for(let w=1;w<=4;w++){ cells+=`<td class="num">${nf(Math.round(now*(1+gr*w/4)))}</td>`; }
    const pct=Math.round(gr*100);
    h+=`<tr><td><span class="dot" style="background:${c};margin-left:6px"></span>${esc(s)}</td>`+
       `<td class="num">${nf(now)}</td>${cells}`+
       `<td class="num" style="color:#3fae6e;font-weight:700">+${pct}%</td></tr>`;
  });
  document.getElementById('fcBox').innerHTML=h+'</tbody></table></div>';
}

// ---------- נטרול פעולות כתיבה (קריאה בלבד) ----------
function doIngest(){ toast('טעינת נתונים זמינה בגרסת השרת המלאה'); }
function exportView(){ toast('ייצוא לאקסל זמין בגרסת השרת המלאה'); }
function expEvents(){ toast('ייצוא לאקסל זמין בגרסת השרת המלאה'); }
function runReport(){ toast('הפקת דוחות זמינה בגרסת השרת המלאה'); }

// ---------- shim: /api/* -> חישוב מקומי (במקום שרת) ----------
const _API={
  'GET /api/filters':      ()=>computeFilters(),
  'GET /api/file_updates': ()=>META.file_updates.slice(),
  'GET /api/reports':      ()=>META.reports.slice(),
  'POST /api/kpi':         b=>computeKpi(b.filters),
  'POST /api/forecast':    b=>computeForecast(b.filters),
  'POST /api/events':      b=>computeEvents(b.kind, b.filters),
};
const _realFetch=window.fetch.bind(window);
window.fetch=async(url,opts)=>{
  if(typeof url==='string' && url.indexOf('/api/')===0){
    const method=(opts&&opts.method)||'GET';
    const body=(opts&&opts.body)?JSON.parse(opts.body):{};
    const fn=_API[method+' '+url];
    const res=fn?fn(body):{ok:false,error:'זמין בגרסת השרת המלאה'};
    return { ok:true, json:async()=>res };
  }
  return _realFetch(url,opts);
};

// ---------- bootstrap: קודם טוענים JSON, ואז מריצים את האתחול המקורי ----------
(async ()=>{
  try{
    await loadData();
    await loadFilters(); loadUpdates(); loadManager(); loadReports();
    const _h=location.hash.slice(1); if(VIEWS.indexOf(_h)>=0) show(_h);
    window.addEventListener('hashchange',()=>{ const h=location.hash.slice(1); if(VIEWS.indexOf(h)>=0) show(h); });
  }catch(e){
    document.body.insertAdjacentHTML('afterbegin',
      '<div style="padding:20px;color:#e08787">שגיאת טעינת נתונים: '+e+'</div>');
    throw e;
  }
})();
