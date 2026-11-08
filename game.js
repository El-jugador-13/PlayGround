(() => {
  'use strict';
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = 19, H = 19, TILE = 32;
  const baseMap = [
    '###################',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o##...........##o#',
    '#.##.#.###.###.##.#',
    '#....#...#...#....#',
    '####.###.#.###.####',
    '#......#...#......#',
    '#.##.#.#...#.#.##.#',
    '#....#.......#....#',
    '###.##.###.######.#',
    '#....#.......#....#',
    '#.##.#.#...#.#.##.#',
    '#....#...#...#....#',
    '####.#.#####.#.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o...............o#',
    '###################'
  ];
  const dirs = {up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0}};
  const reverse = {up:'down',down:'up',left:'right',right:'left'};
  const colors = ['#ff5baf','#6daaff','#ff9d55','#c28cff'];
  const state = {mode:'intro', score:0, high:loadHigh(), lives:3, level:1, dots:0, pellets:[], player:null, ghosts:[], route:new Map(), routeTotal:0, powered:0, shield:0, elapsed:0, clearTimer:0, lastTime:0, acc:0, sound:true, anim:0, particles:[]};
  let audio;
  const $ = id => document.getElementById(id);
  function loadHigh(){ try{return Number(localStorage.getItem('neonMazeHigh')||0)}catch(_){return 0} }
  function storeHigh(){ try{localStorage.setItem('neonMazeHigh',String(state.high))}catch(_){} }
  function resize(){
    const rect=canvas.getBoundingClientRect(), dpr=Math.min(window.devicePixelRatio||1,2);
    canvas.width=Math.max(1,Math.round(rect.width*dpr)); canvas.height=Math.max(1,Math.round(rect.height*dpr));
    ctx.setTransform(canvas.width/(W*TILE),0,0,canvas.height/(H*TILE),0,0);
    draw();
  }
  function isWall(x,y){ return x<0||y<0||x>=W||y>=H||baseMap[y][x]==='#'; }
  function open(x,y){return !isWall(x,y)}
  function makeActor(x,y,dir='left'){return {x,y,from:{x,y},to:{x,y},progress:1,dir,want:dir,step:0.14}}
  function spawnPoint(list){return list.map(([x,y])=>[x,y]).filter(([x,y])=>open(x,y))}
  function initLevel(){
    state.pellets=[]; state.dots=0; state.route.clear(); state.routeTotal=0; state.powered=0; state.elapsed=0;
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){let cell=baseMap[y][x];if(cell==='.'||cell==='o'){state.pellets.push({x,y,power:cell==='o',taken:false});state.dots++}}
    state.player=makeActor(1,1,'right'); state.player.want='right';
    const starts=spawnPoint([[9,9],[8,9],[10,9],[9,8],[9,10],[7,9],[11,9]]);
    const count=Math.min(2+Math.floor((state.level+1)/2),4);
    state.ghosts=Array.from({length:count},(_,i)=>{const [x,y]=starts[i];return {...makeActor(x,y,'left'),color:colors[i],name:['PINK','BLUE','AMBER','VIOLET'][i],ai:i,flashed:0}});
    updateHud();
  }
  function activate(){
    if(state.mode==='intro'||state.mode==='over'||state.mode==='win'){
      if(state.mode==='over'||state.mode==='win'){state.score=0;state.lives=3;state.level=1;state.high=loadHigh()}
      initLevel(); state.mode='playing'; $('startScreen').classList.add('hidden');$('resultScreen').classList.add('hidden');$('pauseScreen').classList.add('hidden');
      sound('start'); state.lastTime=performance.now(); state.acc=0;
    }
  }
  function togglePause(){if(state.mode==='playing'){state.mode='paused';$('pauseScreen').classList.remove('hidden')}else if(state.mode==='paused'){state.mode='playing';$('pauseScreen').classList.add('hidden');state.lastTime=performance.now()}}
  function setDirection(name){if(!dirs[name])return;if(state.mode==='intro'||state.mode==='over'||state.mode==='win')activate();if(state.mode!=='playing')return;state.player.want=name}
  function addMemory(x,y){
    const key=x+','+y, value=(state.route.get(key)||0)+1; state.route.set(key,value);state.routeTotal++;
    // Smooth decay keeps memory responsive while retaining the paths that matter.
    if(state.routeTotal%70===0){for(const [k,v] of state.route){if(v<=1)state.route.delete(k);else state.route.set(k,v-1)}}
  }
  function nearestLearnedTarget(ghost){
    if(state.route.size<3)return {x:state.player.x,y:state.player.y};
    let best=null,bestScore=-Infinity;
    for(const [key,visits] of state.route){const [x,y]=key.split(',').map(Number);if(!open(x,y))continue;
      const distance=Math.abs(x-ghost.x)+Math.abs(y-ghost.y), playerDistance=Math.abs(x-state.player.x)+Math.abs(y-state.player.y);
      if(distance===0)continue;
      // Frequent route nodes attract the hunters; proximity to the current player breaks ties.
      const score=visits*1.7+Math.max(0,12-playerDistance)*.13-distance*.012;
      if(score>bestScore){bestScore=score;best={x,y}}
    }
    return best||{x:state.player.x,y:state.player.y};
  }
  function shortestFirstStep(sx,sy,tx,ty,ghost){
    const q=[[sx,sy,null]], seen=new Set([sx+','+sy]);let head=0;
    while(head<q.length){const [x,y,first]=q[head++];if(x===tx&&y===ty&&first)return first;
      const options=Object.entries(dirs).filter(([name,d])=>open(x+d.x,y+d.y));
      // Ghosts prefer not to reverse unless the maze forces them to.
      options.sort((a,b)=>{const aa=a[0]===reverse[ghost.dir]?1:0,bb=b[0]===reverse[ghost.dir]?1:0;return aa-bb});
      for(const [name,d] of options){const nx=x+d.x,ny=y+d.y,k=nx+','+ny;if(seen.has(k))continue;seen.add(k);q.push([nx,ny,first||name])}
    }
    return null;
  }
  function chooseGhostDir(g){
    let target;
    if(state.powered>0){ // scatter away from Pac-Man while a core is active
      const options=Object.entries(dirs).filter(([_,d])=>open(g.x+d.x,g.y+d.y));
      options.sort((a,b)=>{const da=Math.abs(g.x+a[1].x-state.player.x)+Math.abs(g.y+a[1].y-state.player.y);const db=Math.abs(g.x+b[1].x-state.player.x)+Math.abs(g.y+b[1].y-state.player.y);return db-da});
      return options[0]?.[0]||g.dir;
    }
    target=nearestLearnedTarget(g);
    // A little personality stops all hunters taking the exact same lane.
    if(g.ai===1){const d=dirs[state.player.dir];target={x:Math.max(1,Math.min(W-2,state.player.x+d.x*2)),y:Math.max(1,Math.min(H-2,state.player.y+d.y*2))};if(!open(target.x,target.y))target=nearestLearnedTarget(g)}
    if(g.ai===2&&Math.random()<.18)target={x:state.player.x,y:state.player.y};
    return shortestFirstStep(g.x,g.y,target.x,target.y,g)||g.dir;
  }
  function beginMove(actor,dir){const d=dirs[dir];if(!d||!open(actor.x+d.x,actor.y+d.y))return false;actor.from={x:actor.x,y:actor.y};actor.to={x:actor.x+d.x,y:actor.y+d.y};actor.progress=0;actor.dir=dir;return true}
  function movePlayer(dt){
    const p=state.player;
    if(p.progress<1){p.progress=Math.min(1,p.progress+dt/p.step);if(p.progress>=1){p.x=p.to.x;p.y=p.to.y;addMemory(p.x,p.y);eatAt(p.x,p.y)}return}
    if(p.want!==p.dir&&open(p.x+dirs[p.want].x,p.y+dirs[p.want].y)){beginMove(p,p.want);return}
    if(open(p.x+dirs[p.dir].x,p.y+dirs[p.dir].y))beginMove(p,p.dir);
  }
  function moveGhost(g,dt){
    if(g.progress<1){g.progress=Math.min(1,g.progress+dt/g.step);if(g.progress>=1){g.x=g.to.x;g.y=g.to.y}return}
    g.dir=chooseGhostDir(g); if(!beginMove(g,g.dir)){const viable=Object.entries(dirs).filter(([_,d])=>open(g.x+d.x,g.y+d.y)).map(([n])=>n);if(viable.length)beginMove(g,viable[Math.floor(Math.random()*viable.length)])}
  }
  function eatAt(x,y){
    const p=state.pellets.find(p=>!p.taken&&p.x===x&&p.y===y);if(!p)return;
    p.taken=true;state.dots--;state.score+=p.power?50:10;if(p.power){state.powered=7.4;sound('power');burst(x,y,'#ffe666',15)}else sound('dot');
    if(state.score>state.high){state.high=state.score;storeHigh()}
    updateHud();if(state.dots<=0){state.mode='clearing';state.clearTimer=1.5;sound('clear')}
  }
  function hitCheck(){if(state.shield>0)return;const p=actorPosition(state.player);for(const g of state.ghosts){const gp=actorPosition(g);if(Math.hypot(p.x-gp.x,p.y-gp.y)<.62){if(state.powered>0){g.x=9;g.y=9;g.from={x:9,y:9};g.to={x:9,y:9};g.progress=1;state.score+=200;sound('eat');burst(g.x,g.y,g.color,12);updateHud()}else{state.lives--;state.shield=1.55;sound('hit');updateHud();if(state.lives<=0){endGame(false);return}state.player=makeActor(1,1,'right');state.player.want='right';for(let i=0;i<state.ghosts.length;i++){const [x,y]=spawnPoint([[9,9],[8,9],[10,9],[9,8]])[i];state.ghosts[i]= {...makeActor(x,y,'left'),color:colors[i],ai:i}}return}}}}
  function actorPosition(a){return {x:a.from.x+(a.to.x-a.from.x)*a.progress,y:a.from.y+(a.to.y-a.from.y)*a.progress}}
  function update(dt){state.anim+=dt;state.elapsed+=dt;if(state.mode==='clearing'){state.clearTimer-=dt;if(state.clearTimer<=0){state.level++;initLevel();state.mode='playing';state.shield=1.2;$('sectorNum').textContent=String(state.level).padStart(2,'0');$('levelName').textContent=state.level===2?'PATTERN RECOGNITION':state.level===3?'PREDICTIVE ROUTES':'THE HUNT DEEPENS';}return}if(state.mode!=='playing')return;
    state.powered=Math.max(0,state.powered-dt);state.shield=Math.max(0,state.shield-dt);
    const speedFactor=1+Math.min(.24,(state.level-1)*.07);state.player.step=.145/speedFactor;
    state.ghosts.forEach((g,i)=>{g.step=(state.powered>0?.25:.19-Math.min(.035,(state.level-1)*.008))+(i===0?0:.006)});
    movePlayer(dt);state.ghosts.forEach(g=>moveGhost(g,dt));hitCheck();
    for(const p of state.particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt}state.particles=state.particles.filter(p=>p.life>0);
    updateMemoryHud();
  }
  function endGame(won){state.mode=won?'win':'over';$('resultScreen').classList.remove('hidden');$('resultEyebrow').textContent=won?'SIGNAL MASTERED':'SIGNAL LOST';$('resultTitle').textContent=won?'MAZE CLEARED':'GAME OVER';$('resultText').textContent=won?`You outplayed the hunters with ${state.score.toLocaleString()} points.`:`The ghosts learned your route. Final score: ${state.score.toLocaleString()}.`;sound(won?'clear':'hit')}
  function updateHud(){ $('score').textContent=String(state.score).padStart(5,'0');$('highScore').textContent=String(state.high).padStart(5,'0');$('dotsLeft').textContent=String(state.dots).padStart(2,'0');$('lives').innerHTML=Array.from({length:3},(_,i)=>`<span class="${i>=state.lives?'lost':''}">♥</span>`).join('');$('lives').setAttribute('aria-label',`${state.lives} lives`); }
  function updateMemoryHud(){const pct=Math.min(100,state.routeTotal/1.35);$('memoryFill').style.width=`${pct}%`;$('memoryState').textContent=state.routeTotal<8?'NO DATA':state.routeTotal<38?'BUILDING':'LOCKED IN';const dot=document.querySelector('.readout-dot');if(state.routeTotal>0)dot.classList.add('active');let msg=state.routeTotal<8?'Move to leave a trace':state.routeTotal<26?'Route trace detected · studying':state.routeTotal<65?'Hunters tracking your favorite lanes':'Pattern acquired · switch it up';if(state.powered>0)msg='Power core active · hunters disrupted';$('memoryMessage').textContent=msg}
  function burst(x,y,color,n){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=.7+Math.random()*2.2;state.particles.push({x:x+.5,y:y+.5,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:.35+Math.random()*.5,color})}}
  function sound(type){if(!state.sound)return;try{audio=audio||new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const osc=audio.createOscillator(),gain=audio.createGain();const now=audio.currentTime;osc.connect(gain);gain.connect(audio.destination);const tones={start:[360,.12],dot:[570,.035],power:[220,.24],eat:[760,.12],hit:[110,.27],clear:[660,.4]};const [freq,duration]=tones[type]||[440,.1];osc.frequency.setValueAtTime(freq,now);if(type==='power'||type==='clear')osc.frequency.exponentialRampToValueAtTime(freq*1.8,now+duration);gain.gain.setValueAtTime(.035,now);gain.gain.exponentialRampToValueAtTime(.001,now+duration);osc.start(now);osc.stop(now+duration)}catch(_){}}
  function draw(){if(!ctx||!canvas.width)return;ctx.clearRect(0,0,W*TILE,H*TILE);ctx.fillStyle='#080d1e';ctx.fillRect(0,0,W*TILE,H*TILE);
    // A faint floor grid creates a tactile, dimensional arcade board.
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){const px=x*TILE,py=y*TILE;if(baseMap[y][x]==='#'){drawWall(px,py,x,y)}else{ctx.fillStyle=(x+y)%2?'rgba(13,22,44,.68)':'rgba(11,19,39,.7)';ctx.fillRect(px,py,TILE,TILE);ctx.strokeStyle='rgba(65,91,139,.075)';ctx.lineWidth=.6;ctx.strokeRect(px+.5,py+.5,TILE-1,TILE-1)}}
    // The memory map glows under the most repeated nodes.
    if(state.route.size){let max=1;for(const v of state.route.values())max=Math.max(max,v);for(const [key,v]of state.route){const[x,y]=key.split(',').map(Number);ctx.fillStyle=`rgba(255,83,169,${.035+v/max*.14})`;ctx.beginPath();ctx.arc((x+.5)*TILE,(y+.5)*TILE,10+v/max*5,0,Math.PI*2);ctx.fill()}}
    for(const p of state.pellets){if(p.taken)continue;const x=(p.x+.5)*TILE,y=(p.y+.5)*TILE;if(p.power){const pulse=1+Math.sin(state.anim*6)*.18;ctx.shadowColor='#ffe66d';ctx.shadowBlur=15;ctx.fillStyle='#fff0a0';ctx.beginPath();ctx.arc(x,y,5*pulse,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;ctx.fillStyle='rgba(255,230,102,.2)';ctx.beginPath();ctx.arc(x,y,10*pulse,0,Math.PI*2);ctx.fill()}else{ctx.fillStyle='#e3dcb3';ctx.shadowColor='#fff0bb';ctx.shadowBlur=5;ctx.beginPath();ctx.arc(x,y,2.1,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0}}
    state.particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life/0.8);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x*TILE,p.y*TILE,2,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1});
    for(const g of state.ghosts)drawGhost(g);
    drawPlayer();
    if(state.powered>0){ctx.strokeStyle=`rgba(255,230,102,${.32+.15*Math.sin(state.anim*9)})`;ctx.lineWidth=2;ctx.strokeRect(4,4,W*TILE-8,H*TILE-8)}
  }
  function drawWall(px,py,x,y){
    const s=TILE, shade=((x*7+y*13)%5);
    ctx.save();
    ctx.shadowColor='rgba(0,0,0,.5)';ctx.shadowBlur=5;ctx.shadowOffsetY=3;
    ctx.fillStyle=['#17264a','#19284f','#18254a','#1a2a52','#172448'][shade];ctx.fillRect(px+1,py+1,s-2,s-2);
    ctx.shadowBlur=0;ctx.shadowOffsetY=0;
    ctx.fillStyle='rgba(66,107,166,.16)';ctx.fillRect(px+2,py+2,s-4,2);
    ctx.fillStyle='rgba(2,7,21,.58)';ctx.fillRect(px+2,py+s-4,s-4,2);
    ctx.strokeStyle='rgba(73,132,191,.35)';ctx.lineWidth=1;ctx.strokeRect(px+2.5,py+2.5,s-5,s-5);
    ctx.strokeStyle='rgba(80,227,226,.13)';ctx.lineWidth=1;
    if(!isWall(x, y-1)){ctx.beginPath();ctx.moveTo(px+4,py+2.5);ctx.lineTo(px+s-4,py+2.5);ctx.stroke()}
    if(!isWall(x-1,y)){ctx.beginPath();ctx.moveTo(px+2.5,py+4);ctx.lineTo(px+2.5,py+s-4);ctx.stroke()}
    ctx.restore();
  }
  function drawPlayer(){
    const p=actorPosition(state.player),x=(p.x+.5)*TILE,y=(p.y+.5)*TILE;
    if(state.shield>0&&Math.floor(state.anim*13)%2===0)return;
    const r=11.4,angle={right:0,down:Math.PI/2,left:Math.PI,up:-Math.PI/2}[state.player.dir]||0;
    const mouth=.12+Math.abs(Math.sin(state.anim*13))*.3;
    ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.shadowColor='#ffe66d';ctx.shadowBlur=16;ctx.fillStyle='#ffe66d';ctx.beginPath();ctx.moveTo(0,0);ctx.arc(0,0,r,mouth,Math.PI*2-mouth);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
    ctx.fillStyle='#fff9ce';ctx.beginPath();ctx.arc(-2,-4,1.3,0,Math.PI*2);ctx.fill();ctx.restore();
  }
  function drawGhost(g){
    const p=actorPosition(g),x=(p.x+.5)*TILE,y=(p.y+.5)*TILE,r=11.2,fright=state.powered>0;
    ctx.save();ctx.translate(x,y);const color=fright?(state.powered<2&&Math.floor(state.anim*9)%2?'#f7f5ff':'#5075e8'):g.color;
    ctx.shadowColor=color;ctx.shadowBlur=fright?10:12;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(-r,r*.75);ctx.lineTo(-r,-1);ctx.arc(0,-1,r,-Math.PI,0);ctx.lineTo(r,r*.75);ctx.lineTo(r*.5,r*.45);ctx.lineTo(0,r*.75);ctx.lineTo(-r*.5,r*.45);ctx.closePath();ctx.fill();ctx.shadowBlur=0;
    const look=dirs[g.dir]||dirs.left,ox=look.x*1.1,oy=look.y*.7;
    for(const eyeX of [-4,4]){ctx.fillStyle='#fff';ctx.beginPath();ctx.ellipse(eyeX,-1,3.2,4.2,0,0,Math.PI*2);ctx.fill();ctx.fillStyle=fright?'#f0efff':'#172146';ctx.beginPath();ctx.arc(eyeX+ox,-1+oy,1.65,0,Math.PI*2);ctx.fill()}
    if(fright){ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(-5,5);ctx.lineTo(-2,3);ctx.lineTo(1,5);ctx.lineTo(4,3);ctx.stroke()}
    ctx.restore();
  }
  function frame(now){
    const dt=Math.min(.05,Math.max(0,(now-state.lastTime)/1000||0));state.lastTime=now;
    if(state.mode==='playing'||state.mode==='clearing'){state.acc+=dt;while(state.acc>=1/60){update(1/60);state.acc-=1/60}}
    draw();requestAnimationFrame(frame);
  }
  const keyMap={ArrowUp:'up',w:'up',W:'up',ArrowDown:'down',s:'down',S:'down',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right'};
  window.addEventListener('keydown',e=>{if(keyMap[e.key]){e.preventDefault();setDirection(keyMap[e.key])}else if(e.code==='Space'){e.preventDefault();if(state.mode==='intro'||state.mode==='over'||state.mode==='win')activate();else togglePause()}else if(e.key==='Escape'||e.key==='p'||e.key==='P')togglePause()});
  $('startBtn').addEventListener('click',activate);$('restartBtn').addEventListener('click',activate);$('pauseScreen').addEventListener('click',togglePause);$('mobilePause').addEventListener('click',togglePause);
  document.querySelectorAll('.pad-btn').forEach(button=>{const press=e=>{e.preventDefault();button.classList.add('pressed');setDirection(button.dataset.dir)};const release=()=>button.classList.remove('pressed');button.addEventListener('pointerdown',press);button.addEventListener('pointerup',release);button.addEventListener('pointerleave',release);button.addEventListener('pointercancel',release)});
  let touchStart=null;canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.pointerType==='pen'){touchStart={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId)}});canvas.addEventListener('pointerup',e=>{if(!touchStart)return;const dx=e.clientX-touchStart.x,dy=e.clientY-touchStart.y;if(Math.max(Math.abs(dx),Math.abs(dy))>18)setDirection(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));touchStart=null});
  $('soundBtn').addEventListener('click',()=>{state.sound=!state.sound;$('soundIcon').textContent=state.sound?'♫':'♪';$('.sound-label').textContent=state.sound?'SOUND ON':'SOUND OFF';if(state.sound)sound('dot')});
  window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.mode==='playing')togglePause()});
  $('highScore').textContent=String(state.high).padStart(5,'0');initLevel();state.mode='intro';resize();requestAnimationFrame(frame);
})();
