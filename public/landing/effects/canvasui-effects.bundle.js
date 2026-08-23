(()=>{function Me(c){let p=c.getBoundingClientRect(),t=()=>{p=c.getBoundingClientRect()},i=new ResizeObserver(t);return i.observe(c),window.addEventListener("resize",t,{passive:!0}),window.addEventListener("scroll",t,{capture:!0,passive:!0}),{get current(){return p},destroy(){i.disconnect(),window.removeEventListener("resize",t),window.removeEventListener("scroll",t,!0)}}}var Xe={scale:1,speed:0.6,cover:0.1,density:2.5,shading:0.1,color:"auto",opacity:0.64,shadow:0.06,shadowOffsetX:200,shadowOffsetY:-10,shadowSoftness:1,wind:0.6,windRadius:350,refraction:0,fogBlur:0,quality:1},Be=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main () {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,Ne=`#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uTime;
uniform float uScale;
uniform float uCover;
uniform float uDensity;

const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);

vec2 hash (vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise (vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h
    * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(70.0));
}

float fbm (vec2 n) {
  float total = 0.0;
  float amplitude = 0.1;
  for (int i = 0; i < 7; i++) {
    total += noise(n) * amplitude;
    n = m * n;
    amplitude *= 0.4;
  }
  return total;
}

void main () {
  vec2 p = gl_FragCoord.xy / uResolution + uOffset;
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  float q = fbm(p * asp * uScale * 0.5);

  float r = 0.0;
  vec2 uv = p * asp * uScale;
  uv -= q - uTime;
  float weight = 0.8;
  for (int i = 0; i < 8; i++) {
    r += abs(weight * noise(uv));
    uv = m * uv + uTime;
    weight *= 0.7;
  }

  float f = 0.0;
  uv = p * asp * uScale;
  uv -= q - uTime;
  weight = 0.7;
  for (int i = 0; i < 8; i++) {
    f += weight * noise(uv);
    uv = m * uv + uTime;
    weight *= 0.6;
  }
  f *= r + f;

  float c = 0.0;
  float t2 = uTime * 2.0;
  uv = p * asp * uScale * 2.0;
  uv -= q - t2;
  weight = 0.4;
  for (int i = 0; i < 7; i++) {
    c += weight * noise(uv);
    uv = m * uv + t2;
    weight *= 0.6;
  }

  float c1 = 0.0;
  float t3 = uTime * 3.0;
  uv = p * asp * uScale * 3.0;
  uv -= q - t3;
  weight = 0.4;
  for (int i = 0; i < 7; i++) {
    c1 += abs(weight * noise(uv));
    uv = m * uv + t3;
    weight *= 0.6;
  }
  c += c1;

  float coverage = clamp(uCover + uDensity * f * r + c, 0.0, 1.0);
  outColor = vec4(coverage, clamp(c, 0.0, 1.0), 0.0, 1.0);
}`,Ge=`#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uDecay;
uniform vec2 uA;
uniform vec2 uB;
uniform float uRadius;
uniform float uStrength;

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float prev = texture(uPrev, uv).r * uDecay;
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = uv * asp;
  vec2 a = uA * asp;
  vec2 b = uB * asp;
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h) / max(uRadius, 1e-4);
  float stamp = exp(-d * d * 3.0) * uStrength;
  outColor = vec4(clamp(prev + stamp, 0.0, 1.0), 0.0, 0.0, 1.0);
}`,Oe=`#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uField;
uniform sampler2D uContent;
uniform sampler2D uWind;
uniform vec2 uResolution;
uniform vec2 uContentScale;
uniform vec3 uBase;
uniform float uShading;
uniform float uOpacity;
uniform float uShadow;
uniform vec2 uShadowShift;
uniform float uShadowLod;
uniform float uWindAmt;
uniform float uRefraction;
uniform float uFogBlur;
uniform float uHasContent;

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 field = texture(uField, uv).rg;
  float wind = texture(uWind, uv).r * uWindAmt;
  float cov = field.r - wind;
  float mist = smoothstep(0.04, 0.9, cov);
  float cloudA = mist * uOpacity;

  float lum = dot(uBase, vec3(0.299, 0.587, 0.114));
  float sh = clamp(field.g, 0.0, 1.0);
  float k = uShading * 0.35;
  vec3 cloudRGB = lum > 0.5
    ? uBase - vec3((1.0 - sh) * k)
    : uBase + vec3(sh * k);
  cloudRGB = clamp(cloudRGB, 0.0, 1.0);

  vec2 sUv = uv + uShadowShift;
  float s = textureLod(uField, sUv, uShadowLod).r
    - texture(uWind, sUv).r * uWindAmt;
  float shadowA = smoothstep(0.35, 1.0, s) * uShadow * (1.0 - mist);

  float a;
  vec3 rgb;
  if (uHasContent > 0.5) {
    vec2 e = vec2(8.0) / uResolution;
    float gx = texture(uField, uv + vec2(e.x, 0.0)).r
      - texture(uField, uv - vec2(e.x, 0.0)).r;
    float gy = texture(uField, uv + vec2(0.0, e.y)).r
      - texture(uField, uv - vec2(0.0, e.y)).r;
    vec2 rUv = uv + vec2(gx, gy) * uRefraction * mist;
    vec3 fogged = textureLod(
      uContent, vec2(rUv.x, 1.0 - rUv.y) * uContentScale, mist * uFogBlur * 5.0
    ).rgb;
    vec3 layer = mix(fogged, cloudRGB, cloudA) * (1.0 - shadowA);
    float aF = smoothstep(0.02, 0.2, mist);
    a = aF + shadowA * (1.0 - aF);
    rgb = layer * aF;
  } else {
    a = cloudA + shadowA * (1.0 - cloudA);
    rgb = cloudRGB * cloudA;
  }
  outColor = vec4(rgb, a);
}`;function Fe(c,p={}){let t={...Xe,...p},{source:i,content:n,output:r}=c,e=r.getContext("webgl2",{alpha:!0,depth:!1,stencil:!1,antialias:!1,premultipliedAlpha:!0});if(!e||e.isContextLost())return null;let W=i.getContext("2d"),N=i,b=Boolean(W&&typeof W.drawElementImage==="function"&&typeof N.requestPaint==="function"),H=!1,me=()=>{};if(b)N.onpaint=()=>{try{W.reset(),W.drawElementImage(n,0,0),H=!0,me()}catch{}};function ve(l,x){let d=e.createShader(l);if(e.shaderSource(d,x),e.compileShader(d),!e.getShaderParameter(d,e.COMPILE_STATUS))console.error("Clouds shader error:",e.getShaderInfoLog(d));return d}function de(l){let x=ve(e.VERTEX_SHADER,Be),d=ve(e.FRAGMENT_SHADER,l),M=e.createProgram();e.attachShader(M,x),e.attachShader(M,d),e.linkProgram(M);let _={},se=e.getProgramParameter(M,e.ACTIVE_UNIFORMS);for(let ie=0;ie<se;ie++){let be=e.getActiveUniform(M,ie);_[be.name]=e.getUniformLocation(M,be.name)}return{program:M,vs:x,fs:d,uniforms:_}}let G=de(Ne),C=de(Ge),g=de(Oe),Ee=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,Ee),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let h=e.createTexture();e.bindTexture(e.TEXTURE_2D,h),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE);let k=e.createTexture();e.bindTexture(e.TEXTURE_2D,k),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,255])),e.generateMipmap(e.TEXTURE_2D);function K(){let l=e.createTexture();return e.bindTexture(e.TEXTURE_2D,l),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),l}let ae=[K(),K()],D=0,E=e.createFramebuffer(),f=0,S=0,he=1,F=1,R=[1,1,1],ee=document.createElement("canvas");ee.width=ee.height=1;let O=ee.getContext("2d",{willReadFrequently:!0});function m(){if(t.color!=="auto"){R=t.color;return}if(!O)return;let l=n;while(l){let x=getComputedStyle(l).backgroundColor;if(x&&x!=="transparent"){O.clearRect(0,0,1,1),O.fillStyle=x,O.fillRect(0,0,1,1);let[d,M,_,se]=O.getImageData(0,0,1,1).data;if(se>0){R=[d/255,M/255,_/255];return}}l=l.parentElement}R=[1,1,1]}function z(){let{clientWidth:l,clientHeight:x}=n;if(l>0&&x>0){let Z=`${l}px`,Y=`${x}px`;if(r.style.width!==Z)r.style.width=Z;if(r.style.height!==Y)r.style.height=Y}let d=Math.min(window.devicePixelRatio||1,2),M=Math.max(1,Math.round(r.clientWidth*d)),_=Math.max(1,Math.round(r.clientHeight*d));if(r.width!==M||r.height!==_)r.width=M,r.height=_;he=b?Math.min(1,l/Math.max(i.clientWidth,1)):1,F=b?Math.min(1,x/Math.max(i.clientHeight,1)):1;let se=Math.min(Math.max(t.quality,0.2),1),ie=1440/Math.max(r.clientWidth,1),be=Math.min(se,ie),_e=Math.max(16,Math.round(r.clientWidth*be)),Ue=Math.max(16,Math.round(r.clientHeight*be));if(_e!==f||Ue!==S){f=_e,S=Ue,e.bindTexture(e.TEXTURE_2D,h),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,f,S,0,e.RGBA,e.UNSIGNED_BYTE,null),e.generateMipmap(e.TEXTURE_2D);for(let Z of ae)e.bindTexture(e.TEXTURE_2D,Z),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,f,S,0,e.RGBA,e.UNSIGNED_BYTE,null)}if(b){let Z=Math.max(1,Math.round(i.clientWidth)),Y=Math.max(1,Math.round(i.clientHeight));if(i.width!==Z*d||i.height!==Y*d)i.width=Z*d,i.height=Y*d;N.requestPaint()}}z(),m();function A(){if(!b||!H)return;H=!1,e.bindTexture(e.TEXTURE_2D,k),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,i),e.generateMipmap(e.TEXTURE_2D)}let ue=0.5,V=0.5,L=0.5,w=0.5,q=!1,j=0,fe=Math.random()*64;function ce(l){A(),e.bindFramebuffer(e.FRAMEBUFFER,E),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,h,0),e.viewport(0,0,f,S),e.useProgram(G.program),e.uniform2f(G.uniforms.uResolution,f,S),e.uniform2f(G.uniforms.uOffset,n.scrollLeft/Math.max(n.clientWidth,1),-n.scrollTop/Math.max(n.clientHeight,1)),e.uniform1f(G.uniforms.uTime,fe),e.uniform1f(G.uniforms.uScale,Math.max(t.scale,0.05)),e.uniform1f(G.uniforms.uCover,Math.max(t.cover,0)),e.uniform1f(G.uniforms.uDensity,Math.max(t.density,0)),e.drawArrays(e.TRIANGLE_STRIP,0,4);let x=ae[D],d=ae[1-D];D=1-D,e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,d,0),e.useProgram(C.program),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,x),e.uniform1i(C.uniforms.uPrev,0),e.uniform2f(C.uniforms.uResolution,f,S),e.uniform1f(C.uniforms.uDecay,Math.pow(0.5,l/0.7));let M=Math.hypot(ue-L,V-w),_=q&&M>0;e.uniform2f(C.uniforms.uA,L,w),e.uniform2f(C.uniforms.uB,ue,V),e.uniform1f(C.uniforms.uRadius,Math.max(t.windRadius,1)/Math.max(r.clientHeight,1)),e.uniform1f(C.uniforms.uStrength,_?Math.min(0.2+M*12,1)*0.5:0),e.drawArrays(e.TRIANGLE_STRIP,0,4),L=ue,w=V,e.bindFramebuffer(e.FRAMEBUFFER,null),e.bindTexture(e.TEXTURE_2D,h),e.generateMipmap(e.TEXTURE_2D),e.viewport(0,0,r.width,r.height),e.useProgram(g.program),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,h),e.uniform1i(g.uniforms.uField,0),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,k),e.uniform1i(g.uniforms.uContent,1),e.activeTexture(e.TEXTURE2),e.bindTexture(e.TEXTURE_2D,d),e.uniform1i(g.uniforms.uWind,2),e.uniform2f(g.uniforms.uResolution,r.width,r.height),e.uniform2f(g.uniforms.uContentScale,he,F),e.uniform3f(g.uniforms.uBase,R[0],R[1],R[2]),e.uniform1f(g.uniforms.uOpacity,Math.min(Math.max(t.opacity,0),1)),e.uniform1f(g.uniforms.uShading,Math.max(t.shading,0)),e.uniform1f(g.uniforms.uShadow,Math.min(Math.max(t.shadow,0),1)),e.uniform2f(g.uniforms.uShadowShift,-t.shadowOffsetX/Math.max(r.clientWidth,1),t.shadowOffsetY/Math.max(r.clientHeight,1)),e.uniform1f(g.uniforms.uShadowLod,Math.min(Math.max(t.shadowSoftness,0),1)*4),e.uniform1f(g.uniforms.uWindAmt,Math.min(Math.max(t.wind,0),1)),e.uniform1f(g.uniforms.uRefraction,Math.max(t.refraction,0)/Math.max(r.clientWidth,1)),e.uniform1f(g.uniforms.uFogBlur,Math.min(Math.max(t.fogBlur,0),1)),e.uniform1f(g.uniforms.uHasContent,b?1:0),e.drawArrays(e.TRIANGLE_STRIP,0,4)}let te=0,xe=performance.now(),I=!1,$=!1,Q=!0,re=window.matchMedia("(prefers-reduced-motion: reduce)"),oe=re.matches;function ge(l){if(I)return;if(!Q){$=!1;return}let x=Math.min((l-xe)/1000,0.03333333333333333);if(xe=l,!oe)fe+=x*t.speed*0.03;ce(x);let d=l-j<3000;if(oe&&!d&&!H){$=!1;return}te=requestAnimationFrame(ge)}function P(){if(I||$||!Q)return;$=!0,xe=performance.now(),te=requestAnimationFrame(ge)}me=P,P();function Re(){oe=re.matches,P()}re.addEventListener("change",Re);let u=new ResizeObserver(()=>{z(),P()});u.observe(r),u.observe(n);let v=new IntersectionObserver((l)=>{if(Q=l[l.length-1]?.isIntersecting??!0,Q)P()});v.observe(r);let T=Me(r);function X(l){let x=T.current,d=(l.clientX-x.left)/Math.max(x.width,1),M=1-(l.clientY-x.top)/Math.max(x.height,1);if(!q)L=d,w=M,q=!0;ue=d,V=M,j=performance.now(),P()}function B(){q=!1}n.addEventListener("pointermove",X,{passive:!0}),n.addEventListener("pointerleave",B,{passive:!0}),n.addEventListener("scroll",P,{passive:!0});let le=0;function pe(){m(),P(),window.clearTimeout(le),le=window.setTimeout(()=>{m(),P()},300)}let Se=new MutationObserver(pe);Se.observe(document.documentElement,{attributes:!0,attributeFilter:["class","style","data-theme"]});let ne=window.matchMedia("(prefers-color-scheme: dark)");return ne.addEventListener("change",pe),{setOptions(l){if(!Object.entries(l).some(([x,d])=>t[x]!==d))return;Object.assign(t,l),z(),m(),P()},resize(){z(),P()},destroy(){if(I=!0,T.destroy(),cancelAnimationFrame(te),u.disconnect(),v.disconnect(),Se.disconnect(),ne.removeEventListener("change",pe),window.clearTimeout(le),re.removeEventListener("change",Re),n.removeEventListener("pointermove",X),n.removeEventListener("pointerleave",B),n.removeEventListener("scroll",P),b)N.onpaint=null;e.deleteTexture(h),e.deleteTexture(k),e.deleteTexture(ae[0]),e.deleteTexture(ae[1]),e.deleteFramebuffer(E),e.deleteProgram(G.program),e.deleteProgram(C.program),e.deleteProgram(g.program),e.deleteShader(G.vs),e.deleteShader(G.fs),e.deleteShader(C.vs),e.deleteShader(C.fs),e.deleteShader(g.vs),e.deleteShader(g.fs),e.deleteBuffer(Ee)}}}var We={frost:0.05,strength:0.7,contrast:3,crispness:1,highlight:0.3,highlightStrength:0.8,haze:0.5,tintThin:[0.82,0.86,1.05],tintThick:[0.92,0.96,1.1],tintStrength:0.3,saturation:1.2,brightness:0.85,refraction:1,ior:1.31,detail:2,textureScale:2,fresnel:0.8,meltRadius:0.25,meltNoise:0.25,meltStrength:0.75,refreeze:2,edgeFade:0.1,meltEdges:!0,introDuration:2.5,opacity:0.6,shimmer:0,quality:1},He=10,Ae=512,Pe=1024,ke=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,ze=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
float prnd (vec2 n, float period) {
  n = mod(n, period);
  float dt = dot(n, vec2(0.129898, 0.78233));
  return fract(sin(mod(dt, 3.14159265)) * 437.585453);
}
float pnoise (vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = prnd(i, period);
  float b = prnd(i + vec2(1.0, 0.0), period);
  float c = prnd(i + vec2(0.0, 1.0), period);
  float d = prnd(i + vec2(1.0, 1.0), period);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm (vec2 p, float period, int octaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    if (i >= octaves) break;
    v += a * pnoise(p, period);
    p = p * 2.0 + vec2(17.0, 31.0);
    period *= 2.0;
    a *= 0.5;
  }
  return v;
}
float pwarp (vec2 p, float period, float g) {
  float val = 0.0;
  for (int i = 0; i < 2; i++) {
    val = pfbm(
      p + g * vec2(cos(6.28318 * val), sin(6.28318 * val)), period, 4);
  }
  return val;
}
void main () {
  float pattern = pwarp(vUv * 20.0, 20.0, 4.0);
  float mottle = pfbm(vUv * 26.0, 26.0, 3);
  float sparkle =
    smoothstep(0.8, 0.95, pnoise(vUv * 200.0, 200.0)) *
    (0.35 + 0.65 * pnoise(vUv * 50.0, 50.0));
  float meltEdge = pfbm(vUv * 9.0, 9.0, 3);
  outColor = vec4(pattern, mottle, sparkle, meltEdge);
}`,qe=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
float prnd (vec2 n, float period) {
  n = mod(n, period);
  float dt = dot(n, vec2(0.129898, 0.78233));
  return fract(sin(mod(dt, 3.14159265)) * 437.585453);
}
float pnoise (vec2 p, float period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = prnd(i, period);
  float b = prnd(i + vec2(1.0, 0.0), period);
  float c = prnd(i + vec2(0.0, 1.0), period);
  float d = prnd(i + vec2(1.0, 1.0), period);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float pfbm (vec2 p, float period, int octaves) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    if (i >= octaves) break;
    v += a * pnoise(p, period);
    p *= 2.0;
    period *= 2.0;
    a *= 0.5;
  }
  return v;
}
void main () {
  float broad = pfbm(vUv * 6.0, 6.0, 4);
  broad = broad * broad * 1.4;
  float fine = pfbm(vUv * 28.0, 28.0, 3);
  outColor = vec4(broad, fine, 0.0, 1.0);
}`,Ye=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uScene;
uniform vec2 uTexelSize;
uniform vec2 uStep;
uniform float uFlipY;
WEIGHTS_PLACEHOLDER
vec2 srcUv (vec2 uv) {
  return uFlipY > 0.5 ? vec2(uv.x, 1.0 - uv.y) : uv;
}
void main () {
  vec4 sum = texture(uScene, srcUv(vUv)) * WEIGHT_CENTER;
  for (int i = 1; i < KERNEL_SIZE; i++) {
    vec2 delta = float(i) * uTexelSize * uStep;
    sum += texture(uScene, srcUv(clamp(vUv + delta, 0.0, 1.0))) * WEIGHTS[i - 1];
    sum += texture(uScene, srcUv(clamp(vUv - delta, 0.0, 1.0))) * WEIGHTS[i - 1];
  }
  outColor = sum;
}`,Ke=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uBack;
uniform sampler2D uNoise;
uniform vec2 uPoint;
uniform vec2 uPrevPoint;
uniform vec2 uBackShift;
uniform vec2 uScroll;
uniform float uAspect;
uniform float uTextureScale;
uniform float uDecay;
uniform float uMeltNoise;
uniform float uMeltStrength;
uniform float uRadius;
uniform float uEdgeFade;
uniform float uTouching;
float sdSegment (vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}
void main () {
  vec2 backUv = vUv + uBackShift;
  vec4 back = texture(uBack, backUv);
  float inside =
    step(0.0, backUv.x) * step(backUv.x, 1.0) *
    step(0.0, backUv.y) * step(backUv.y, 1.0);
  float melt = clamp(back.r * inside - uDecay, 0.0, 1.0);

  vec2 nUv = (vUv + uScroll) * vec2(uAspect, 1.0)
    / max(uTextureScale, 0.05);
  float n = texture(uNoise, nUv).a - 0.5;

  vec2 p = vUv * vec2(uAspect, 1.0);
  vec2 a = uPrevPoint * vec2(uAspect, 1.0);
  vec2 b = uPoint * vec2(uAspect, 1.0);
  float d = sdSegment(p, a, b) + n * uMeltNoise;

  float m =
    (1.0 - smoothstep(uRadius * 0.35, uRadius, d)) * uMeltStrength;
  vec2 dSide = min(vUv, 1.0 - vUv);
  float side = smoothstep(0.0, max(uEdgeFade, 1e-4), min(dSide.x, dSide.y));
  m *= mix(1.0, side, step(1e-3, uEdgeFade));
  m *= uTouching;

  melt = clamp(melt + m, 0.0, 1.0);
  outColor = vec4(vec3(melt), 1.0);
}`,Ve=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform sampler2D uBlur;
uniform sampler2D uNoise;
uniform sampler2D uPointer;
uniform vec2 uScroll;
uniform float uAspect;
uniform float uTextureScale;
uniform float uMeltEdges;
uniform float uIntro;
uniform float uHighlight;
uniform float uStrength;
uniform float uFrost;
uniform float uContrast;
uniform float uCrispness;
uniform float uHaze;
uniform vec3 uTintThin;
uniform vec3 uTintThick;
uniform float uTintStrength;
uniform float uHighlightStrength;
uniform float uSaturation;
uniform float uBrightness;
uniform float uShimmer;
uniform float uTime;
uniform float uOpacity;
uniform float uHasContent;
float contrastFn (float x, float strength) {
  return clamp((x - 0.5) * strength + 0.5, 0.0, 1.0);
}
float rand2 (vec2 uv) {
  uv = floor(uv * 5000.0) / 5000.0;
  float a = dot(uv, vec2(92.0, 80.0));
  float b = dot(uv, vec2(41.0, 62.0));
  return fract(sin(a) + cos(b) * 51.0);
}
vec3 hsv2rgb (vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
vec3 rgb2hsv (vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
void main () {
  vec2 nUv = (vUv + uScroll) * vec2(uAspect, 1.0)
    / max(uTextureScale, 0.05);
  vec4 noise = texture(uNoise, nUv);
  float warpN = noise.r;

  float meltRaw = texture(uPointer, vUv).r;

  vec2 edgeDist = min(vUv, 1.0 - vUv);
  float edgeBoost =
    (1.0 - smoothstep(0.0, 0.4, min(edgeDist.x, edgeDist.y)))
    * (1.0 - uMeltEdges * smoothstep(0.0, 0.5, meltRaw));
  float strength = uStrength * (0.62 + 0.65 * edgeBoost);

  float ed = min(edgeDist.x, edgeDist.y)
    + (0.5 - warpN) * 0.34 + (0.5 - noise.g) * 0.16;
  float local = clamp((uIntro * 3.0 - ed * 2.0 - 0.3) / 1.1, 0.0, 1.0);
  strength *= local;

  float body = contrastFn(warpN * strength + uFrost * local, uContrast);

  vec2 gUv = vUv + uScroll;
  float h = rand2(gUv + warpN * 0.05);
  float grain = h * warpN;
  float glint = smoothstep(0.85, 1.0, h);
  glint *= mix(
    1.0,
    0.5 + 0.5 * sin(uTime * 2.4 + h * 6.28),
    clamp(uShimmer, 0.0, 1.0)
  );
  float micro = mix(grain, glint, uHighlight);

  float m = clamp(meltRaw * (1.1 + (noise.a - 0.5) * 0.9), 0.0, 1.0);

  float d = body - m * (0.9 + 0.35 * body);
  float frozen = smoothstep(0.0, 0.22, d);
  float wet = (1.0 - frozen) * (1.0 - smoothstep(0.0, 0.55, -d));
  wet *= smoothstep(0.01, 0.1, m);

  float cover = smoothstep(0.03, 0.35, body);
  float ice = clamp(
    contrastFn(micro * cover * frozen + body, uCrispness), 0.0, 1.0);
  float frostMask = ice * frozen;

  vec2 wobble = vec2(noise.a - 0.5, noise.g - 0.5) * wet * 0.018;

  vec3 icy = mix(uTintThin, uTintThick, body);
  vec4 base;
  vec4 blur;
  if (uHasContent > 0.5) {
    vec2 cUv = clamp(vUv + wobble, 0.0, 1.0);
    base = texture(uContent, vec2(cUv.x, 1.0 - cUv.y));
    blur = texture(uBlur, cUv);
  } else {
    base = vec4(icy, 1.0);
    blur = base;
  }
  float blurMix = clamp(
    frostMask + uHaze * max(frozen, wet * 0.5), 0.0, 1.0);
  vec4 color = mix(base, blur, blurMix);

  vec3 hsv = rgb2hsv(color.rgb);
  hsv.y = clamp(hsv.y * uSaturation, 0.0, 1.0);
  hsv.z = clamp(hsv.z * uBrightness, 0.0, 1.0);
  vec3 adjusted = hsv2rgb(hsv);
  color.rgb = mix(color.rgb, adjusted, frostMask);

  vec3 frostTint = mix(uTintThin, uTintThick, body);
  vec3 frostColor = mix(color.rgb, frostTint, uTintStrength);
  frostColor = mix(
    frostColor,
    vec3(1.0),
    glint * uHighlightStrength * step(0.001, uHighlight));

  color.rgb = mix(color.rgb, frostColor, frostMask);
  color.rgb += wet * glint * 0.25;

  float op = clamp(uOpacity, 0.0, 1.0);
  color.rgb = mix(base.rgb, color.rgb, op);
  outColor = vec4(clamp(color.rgb, 0.0, 1.0), frostMask * op);
}`,je=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFrost;
uniform sampler2D uHeights;
uniform float uIor;
uniform float uRefraction;
uniform float uDetail;
uniform float uTextureScale;
uniform float uFresnel;
uniform vec2 uScrollPx;
uniform float uHasContent;
uniform float uFallbackAlpha;

const float TEXEL = 1.0 / ${Ae}.0;

vec3 heightNormal (float channel, vec2 mapUv, float bump) {
  vec2 hx = vec2(TEXEL, 0.0);
  vec2 hy = vec2(0.0, TEXEL);
  vec2 c = texture(uHeights, mapUv).rg;
  vec2 x = texture(uHeights, mapUv + hx).rg;
  vec2 y = texture(uHeights, mapUv + hy).rg;
  float dx = channel < 0.5 ? x.r - c.r : x.g - c.g;
  float dy = channel < 0.5 ? y.r - c.r : y.g - c.g;
  return normalize(vec3(-dx * bump, -dy * bump, 1.0));
}

void main () {
  vec2 baseUv = vUv;
  float frostMask = texture(uFrost, baseUv).a;

  vec3 V = vec3(0.0, 0.0, 1.0);

  float mainScale = max(uTextureScale, 0.05) * 900.0;
  float subScale = max(uTextureScale, 0.05) * 260.0;
  vec2 mapCoord = gl_FragCoord.xy + uScrollPx;
  vec2 mainUv = mapCoord / mainScale;
  vec2 subUv = mapCoord / subScale;

  vec3 nMain = heightNormal(0.0, mainUv, 14.0);
  vec3 nSub = heightNormal(1.0, subUv, 8.0);

  float heightW = smoothstep(0.1, 0.95, texture(uHeights, mainUv).r);

  vec3 R1 = refract(-V, nMain, 1.0 / uIor);
  vec3 R2 = refract(-V, nSub, 1.0 / uIor);
  vec2 offset = (R1.xy * 0.3 + R2.xy * uDetail * heightW * 0.5)
    * uRefraction * 0.2;

  vec2 refractedUv = clamp(baseUv + offset, 0.0, 1.0);

  vec4 baseColor = texture(uFrost, vUv);
  vec4 refractedColor = texture(uFrost, refractedUv);

  float cosTheta = clamp(dot(-V, nMain), 0.0, 1.0);
  float F0 = pow((uIor - 1.0) / (uIor + 1.0), 2.0);
  float fresnel = F0 + (1.0 - F0) * pow(1.0 - cosTheta, 5.0);

  float refractionMix = frostMask;
  refractionMix = clamp(refractionMix * (1.0 + fresnel * uFresnel), 0.0, 1.0);

  vec4 mixed = mix(baseColor, refractedColor, refractionMix);
  if (uHasContent > 0.5) {
    outColor = vec4(mixed.rgb, 1.0);
  } else {
    float alpha = clamp(mixed.a * uFallbackAlpha, 0.0, 1.0);
    outColor = vec4(mixed.rgb * alpha, alpha);
  }
}`;function $e(c){let p=[],t=0;for(let n=0;n<c;n++){let r=Math.exp(-0.5*(n*n)/(c*c*0.25));p.push(r),t+=n===0?r:r*2}let i=p.map((n)=>(n/t).toFixed(6));return[`#define KERNEL_SIZE ${c}`,`#define WEIGHT_CENTER ${i[0]}`,`const float WEIGHTS[KERNEL_SIZE - 1] = float[KERNEL_SIZE - 1](${i.slice(1).join(", ")});`].join(`
`)}function Ce(c,p={}){let t={...We,...p},{source:i,content:n,output:r}=c,e=r.getContext("webgl2",{alpha:!0,depth:!1,stencil:!1,antialias:!1,premultipliedAlpha:!0});if(!e||e.isContextLost())return null;let W=i.getContext("2d"),N=i,b=Boolean(W&&typeof W.drawElementImage==="function"&&typeof N.requestPaint==="function"),H=!1,me=!b,ve=()=>{};function de(){try{W.reset(),W.drawElementImage(n,0,0),H=!0,ve()}catch{}}if(b)N.onpaint=de;let G=Boolean(e.getExtension("EXT_color_buffer_float")),C=[],g=[];function Ee(o,a){let s=e.createShader(o);if(e.shaderSource(s,a),e.compileShader(s),!e.getShaderParameter(s,e.COMPILE_STATUS))console.error("Frost shader error:",e.getShaderInfoLog(s));return C.push(s),s}let h=Ee(e.VERTEX_SHADER,ke);function k(o){let a=e.createProgram();e.attachShader(a,h),e.attachShader(a,Ee(e.FRAGMENT_SHADER,o)),e.linkProgram(a),g.push(a);let s={},y=e.getProgramParameter(a,e.ACTIVE_UNIFORMS);for(let U=0;U<y;U++){let J=e.getActiveUniform(a,U);s[J.name]=e.getUniformLocation(a,J.name)}return{program:a,uniforms:s}}let K=k(ze),ae=k(qe),D=k(Ye.replace("WEIGHTS_PLACEHOLDER",$e(He))),E=k(Ke),f=k(Ve),S=k(je),he=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,he),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);function F(o,a,s,y){let U=e.createTexture();e.bindTexture(e.TEXTURE_2D,U),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,y),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,y),e.texImage2D(e.TEXTURE_2D,0,s?e.RGBA16F:e.RGBA8,o,a,0,e.RGBA,s?e.HALF_FLOAT:e.UNSIGNED_BYTE,null);let J=e.createFramebuffer();return e.bindFramebuffer(e.FRAMEBUFFER,J),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,U,0),e.viewport(0,0,o,a),e.clearColor(0,0,0,0),e.clear(e.COLOR_BUFFER_BIT),{fbo:J,texture:U,width:o,height:a}}function R(o){if(!o)return;e.deleteFramebuffer(o.fbo),e.deleteTexture(o.texture)}function ee(o,a,s){let y=F(o,a,s,e.CLAMP_TO_EDGE),U=F(o,a,s,e.CLAMP_TO_EDGE);return{get read(){return y},get write(){return U},swap(){let J=y;y=U,U=J}}}let O=null,m=null,z=null,A=null,ue=F(Ae,Ae,!1,e.REPEAT),V=F(Pe,Pe,!1,e.REPEAT);function L(o){if(o)e.bindFramebuffer(e.FRAMEBUFFER,o.fbo),e.viewport(0,0,o.width,o.height);else e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,r.width,r.height);e.drawArrays(e.TRIANGLE_STRIP,0,4)}function w(o,a){return e.activeTexture(e.TEXTURE0+a),e.bindTexture(e.TEXTURE_2D,o),a}e.useProgram(ae.program),L(ue),e.useProgram(K.program),L(V);let q=e.createTexture();e.bindTexture(e.TEXTURE_2D,q),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));let j=!0,fe=!1;function ce(){let o=Math.max(r.width,1),a=Math.max(r.height,1),s=0.35*Math.min(Math.max(t.quality,0.25),1),y=Math.max(1,Math.round(o*s)),U=Math.max(1,Math.round(a*s));if(R(O),R(m),R(z),A)R(A.read),R(A.write);O=F(o,a,!1,e.CLAMP_TO_EDGE),m=F(y,U,!1,e.CLAMP_TO_EDGE),z=F(y,U,!1,e.CLAMP_TO_EDGE),A=ee(Math.max(1,Math.round(o*0.5)),Math.max(1,Math.round(a*0.5)),G),fe=!0,j=!0}function te(){let o=Math.min(window.devicePixelRatio||1,2),a=Math.max(1,Math.round(r.clientWidth*o)),s=Math.max(1,Math.round(r.clientHeight*o));if(r.width!==a||r.height!==s)r.width=a,r.height=s,ce();else if(!fe)ce();if(b){let y=Math.max(1,Math.round(i.clientWidth)),U=Math.max(1,Math.round(i.clientHeight));if(i.width!==y*o||i.height!==U*o)i.width=y*o,i.height=U*o;N.requestPaint()}}if(te(),b)de();function xe(){if(!b||!H)return;if(H=!1,j=!0,e.bindTexture(e.TEXTURE_2D,q),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,i),!me)me=!0,l=performance.now()}function I(){if(!j||!b||!m||!z)return;j=!1,e.useProgram(D.program),e.uniform2f(D.uniforms.uTexelSize,1/m.width,1/m.height),e.uniform1i(D.uniforms.uScene,w(q,0)),e.uniform2f(D.uniforms.uStep,0,1),e.uniform1f(D.uniforms.uFlipY,1),L(m),e.uniform1i(D.uniforms.uScene,w(m.texture,0)),e.uniform2f(D.uniforms.uStep,1,0),e.uniform1f(D.uniforms.uFlipY,0),L(z)}let $=!1,Q=0.5,re=0.5,oe=0.5,ge=0.5,P=0,Re=0,u=[];function v(){if(!A)return;let o=Math.max(r.clientWidth,1),a=Math.max(r.clientHeight,1),s=n.scrollLeft,y=n.scrollTop;if(e.useProgram(E.program),e.uniform1i(E.uniforms.uBack,w(A.read.texture,0)),e.uniform1i(E.uniforms.uNoise,w(V.texture,1)),e.uniform1f(E.uniforms.uAspect,r.width/Math.max(r.height,1)),e.uniform2f(E.uniforms.uBackShift,(s-P)/o,-(y-Re)/a),e.uniform2f(E.uniforms.uScroll,s/o,-y/a),e.uniform1f(E.uniforms.uTextureScale,t.textureScale),e.uniform1f(E.uniforms.uDecay,t.refreeze*0.001),e.uniform1f(E.uniforms.uMeltNoise,t.meltNoise),e.uniform1f(E.uniforms.uMeltStrength,t.meltStrength*0.2),e.uniform1f(E.uniforms.uRadius,t.meltRadius),e.uniform1f(E.uniforms.uEdgeFade,t.meltEdges?0:t.edgeFade),u.length>0){for(let[U,J]of u)e.uniform2f(E.uniforms.uPoint,U,1-J),e.uniform2f(E.uniforms.uPrevPoint,U,1-J),e.uniform1f(E.uniforms.uTouching,1),L(A.write),A.swap(),e.uniform1i(E.uniforms.uBack,w(A.read.texture,0)),e.uniform2f(E.uniforms.uBackShift,0,0);u=[]}else e.uniform2f(E.uniforms.uPoint,Q,1-re),e.uniform2f(E.uniforms.uPrevPoint,oe,1-ge),e.uniform1f(E.uniforms.uTouching,$?1:0),L(A.write),A.swap();P=s,Re=y,oe=Q,ge=re}function T(o){if(!O||!A||!z)return;let a=Math.max(r.clientWidth,1),s=Math.max(r.clientHeight,1);e.useProgram(f.program),e.uniform1i(f.uniforms.uContent,w(q,0)),e.uniform1i(f.uniforms.uBlur,w(z.texture,1)),e.uniform1i(f.uniforms.uNoise,w(V.texture,2)),e.uniform1i(f.uniforms.uPointer,w(A.read.texture,3)),e.uniform2f(f.uniforms.uScroll,n.scrollLeft/a,-n.scrollTop/s),e.uniform1f(f.uniforms.uAspect,r.width/Math.max(r.height,1)),e.uniform1f(f.uniforms.uTextureScale,t.textureScale),e.uniform1f(f.uniforms.uMeltEdges,t.meltEdges?1:0),e.uniform1f(f.uniforms.uIntro,x(o)),e.uniform1f(f.uniforms.uHighlight,t.highlight),e.uniform1f(f.uniforms.uStrength,t.strength),e.uniform1f(f.uniforms.uFrost,t.frost),e.uniform1f(f.uniforms.uContrast,t.contrast),e.uniform1f(f.uniforms.uCrispness,t.crispness),e.uniform1f(f.uniforms.uHaze,t.haze),e.uniform3f(f.uniforms.uTintThin,t.tintThin[0],t.tintThin[1],t.tintThin[2]),e.uniform3f(f.uniforms.uTintThick,t.tintThick[0],t.tintThick[1],t.tintThick[2]),e.uniform1f(f.uniforms.uTintStrength,t.tintStrength),e.uniform1f(f.uniforms.uHighlightStrength,t.highlightStrength),e.uniform1f(f.uniforms.uSaturation,t.saturation),e.uniform1f(f.uniforms.uBrightness,t.brightness),e.uniform1f(f.uniforms.uShimmer,t.shimmer),e.uniform1f(f.uniforms.uTime,o/1000),e.uniform1f(f.uniforms.uOpacity,Math.min(Math.max(t.opacity,0),1)),e.uniform1f(f.uniforms.uHasContent,b?1:0),L(O)}function X(){if(!O)return;let o=r.width/Math.max(r.clientWidth,1);e.useProgram(S.program),e.uniform1i(S.uniforms.uFrost,w(O.texture,0)),e.uniform1i(S.uniforms.uHeights,w(ue.texture,2)),e.uniform1f(S.uniforms.uIor,Math.max(t.ior,1.01)),e.uniform1f(S.uniforms.uRefraction,t.refraction),e.uniform1f(S.uniforms.uDetail,t.detail),e.uniform1f(S.uniforms.uTextureScale,t.textureScale),e.uniform1f(S.uniforms.uFresnel,t.fresnel),e.uniform2f(S.uniforms.uScrollPx,n.scrollLeft*o,-n.scrollTop*o),e.uniform1f(S.uniforms.uHasContent,b?1:0),e.uniform1f(S.uniforms.uFallbackAlpha,0.85),L(null)}let B=0,le=!1,pe=!1,Se=!0,ne=0,l=performance.now();function x(o){let a=Math.max(t.introDuration,0)*1000;if(a<=0||ie)return 1;let s=Math.min(Math.max((o-l)/a,0),1);return s*s*(3-2*s)}function d(){return 1/Math.max(t.refreeze*0.001,0.00001)/60*1000+500}function M(o){if(le)return;if(!Se){pe=!1;return}if(e.disable(e.BLEND),xe(),!me){pe=!1;return}if(I(),v(),T(o),X(),!($||o<ne||o<l+Math.max(t.introDuration,0)*1000+120||H||t.shimmer>0.001)){pe=!1;return}B=requestAnimationFrame(M)}function _(){if(le||pe||!Se)return;pe=!0,B=requestAnimationFrame(M)}ve=_,_();let se=window.matchMedia("(prefers-reduced-motion: reduce)"),ie=se.matches;function be(){if(ie=se.matches,!ie)_()}se.addEventListener("change",be);let _e=Me(r);function Ue(o){if(ie)return;let a=_e.current;Q=(o.clientX-a.left)/Math.max(a.width,1),re=(o.clientY-a.top)/Math.max(a.height,1),$=!0,ne=performance.now()+d(),_()}function Z(){$=!1,ne=performance.now()+d(),_()}let Y=r.parentElement??r;Y.addEventListener("pointermove",Ue,{passive:!0}),Y.addEventListener("pointerdown",Ue,{passive:!0}),Y.addEventListener("pointerleave",Z),Y.addEventListener("pointercancel",Z);function ye(){if(ne=Math.max(ne,performance.now()+400),b)N.requestPaint?.();_()}n.addEventListener("scroll",ye,{passive:!0});let we=new ResizeObserver(()=>{te(),_()});we.observe(r);let De=new IntersectionObserver((o)=>{if(Se=o[o.length-1]?.isIntersecting??!0,Se)_()});return De.observe(r),{melt(o,a){if(ie)return;u.push([o,a]),ne=performance.now()+d(),_()},setOptions(o){if(!Object.entries(o).some(([U,J])=>t[U]!==J))return;let{quality:a,...s}=o,y=a!==void 0&&a!==t.quality;if(Object.assign(t,s),y)t.quality=a,ce();ne=Math.max(ne,performance.now()+100),_()},resize(){te(),_()},destroy(){if(le=!0,_e.destroy(),cancelAnimationFrame(B),we.disconnect(),De.disconnect(),se.removeEventListener("change",be),R(V),R(O),R(m),R(z),A)R(A.read),R(A.write);if(R(ue),e.deleteTexture(q),g.forEach((o)=>e.deleteProgram(o)),C.forEach((o)=>e.deleteShader(o)),e.deleteBuffer(he),b)N.onpaint=null;n.removeEventListener("scroll",ye),Y.removeEventListener("pointermove",Ue),Y.removeEventListener("pointerdown",Ue),Y.removeEventListener("pointerleave",Z),Y.removeEventListener("pointercancel",Z)}}}var Qe={intensity:0.5,speed:1,scale:0.4,dropWidth:1,dropLength:1,refraction:0.2,blur:0,vignette:0,fallSpeed:1,wiggle:1,staticDrops:0.2,interactive:!0,interactionRadius:0.3,interactionStrength:0.6,interactionDistortion:3,tint:[1,1,1],tintStrength:0},Ze=`#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
out vec2 vUv;
void main () {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`,Je=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uContent;
uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uTime;
uniform float uIntensity;
uniform float uScale;
uniform float uDropWidth;
uniform float uDropLength;
uniform float uRefraction;
uniform float uBlur;
uniform float uVignette;
uniform float uFallSpeed;
uniform float uWiggle;
uniform float uStaticDrops;
uniform float uMaxX;
uniform sampler2D uTrail;
uniform float uWipe;
uniform float uWipeDistort;
uniform vec3 uTint;
uniform float uTintStrength;
uniform float uHasContent;

#define S(a, b, t) smoothstep(a, b, t)

vec3 N13 (float p) {
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.11369, 0.13787));
  p3 += dot(p3, p3.yzx + 19.19);
  return fract(vec3(
    (p3.x + p3.y) * p3.z,
    (p3.x + p3.z) * p3.y,
    (p3.y + p3.z) * p3.x
  ));
}

float N (float t) {
  return fract(sin(t * 12345.564) * 7658.76);
}

float Saw (float b, float t) {
  return S(0.0, b, t) * S(1.0, b, t);
}

float sdEgg (vec2 p, float ra, float rb) {
  const float k = 1.7320508;
  p.x = abs(p.x);
  float r = ra - rb;
  return ((p.y < 0.0) ? length(vec2(p.x, p.y)) - r :
          (k * (p.x + r) < p.y) ? length(vec2(p.x, p.y - k * r)) :
          length(vec2(p.x + r, p.y)) - 2.0 * r) - rb;
}

vec2 DropLayer (vec2 uv, float t) {
  vec2 UV = uv;
  vec2 a = vec2(6.0, 1.0);
  vec2 grid = a * 2.0;

  vec2 id = floor(uv * grid);
  float gridFall = N(id.x) / 3.0 + 0.5;
  uv.y += t * gridFall / a.y;
  id = floor(uv * grid);
  uv.y += N(id.x);

  id = floor(uv * grid);
  vec2 st = fract(uv * grid) - vec2(0.5, 0.0);
  vec3 n = N13(id.x * 35.2 + id.y * 2376.1);

  float x = n.x - 0.5;
  float lambda = UV.y * 20.0;
  float wiggle = sin(lambda + sin(lambda));
  x += wiggle * (0.5 - abs(x)) * (n.z - 0.5) * uWiggle;
  x *= 0.6;

  float slowStart = 0.85;
  float ti = fract(t * (gridFall + 0.1) + n.z);
  float y = (Saw(slowStart, ti) - 0.5) * 0.9 + 0.5;
  vec2 p = vec2(x, y);

  float dropShape = (ti > slowStart)
    ? -sin(6.2831853 * ti / (1.0 - slowStart)) * 0.5 - 0.5
    : 0.0;
  float d = sdEgg((st - p) * a.yx / vec2(uDropWidth, uDropLength), 0.0, dropShape);
  float diameter = N(id.x + id.y) / 7.0 + 0.2;
  float mainDrop = S(diameter / 1.5, 0.0, d);

  float r2 = S(1.0, y, st.y);
  float r = sqrt(r2);
  float cd = abs(st.x - x);
  float thickness = diameter * 0.95 * uDropWidth;
  float trail = S(thickness * r, 0.0, cd);
  float trailFront = S(-0.02, 0.02, st.y - y);
  trail *= r2 * trailFront * 0.5;

  y = UV.y;
  float trail2 = S((thickness - 0.15) * r, 0.0, cd);
  trail2 *= trailFront * n.z;
  float rndX = N(id.x) / 1.5 + 0.5;
  float rndY = N(st.y) / 40.0 + 0.05;
  y = fract(y * 11.0 * rndX) + (st.y - 0.5);
  float dd = length(st - vec2(x, y));
  float droplets = S(trail2 + rndY, 0.0, dd);

  float m = mainDrop + droplets * r * trailFront;
  return vec2(m, trail);
}

float StaticDrops (vec2 uv, float t) {
  uv *= 40.0;

  vec2 id = floor(uv);
  vec3 n = N13(id.x * 107.45 + id.y * 3543.654);
  vec2 p = (n.xy - 0.5) * 0.6;
  uv = fract(uv) - 0.5;

  float d = length(uv - p);
  float drop = S(0.3 * clamp(uDropWidth, 0.4, 1.4), 0.0, d);

  float fade = Saw(0.1, fract(t + n.y));
  float intensity = fract(n.x * 27.0);
  return drop * fade * intensity;
}

vec2 Drops (vec2 uv, float t, float tFall, float l0, float l1, float l2, float wipe) {
  float s = StaticDrops(uv, t) * l0 * (1.0 - wipe);
  vec2 m1 = DropLayer(uv, tFall) * (l1 * (1.0 - wipe * 0.8));
  vec2 m2 = DropLayer(uv * 1.85, tFall) * (l2 * (1.0 - wipe * 0.8));

  float c = s + m1.x + m2.x;
  c = S(0.3, 1.0, c);

  return vec2(c, m1.y + m2.y);
}

void main () {
  vec2 uv = vUv;

  if (uv.x > uMaxX) {
    outColor = vec4(0.0);
    return;
  }

  vec2 aspectUv = (uv + uOffset - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);
  float t = uTime * 0.2;
  float dropScale = clamp(min(uResolution.x, uResolution.y) / 900.0, 0.75, 1.35) * uScale;
  vec2 scaledUv = aspectUv * dropScale;

  float rainAmount = clamp(uIntensity, 0.0, 1.25);

  float staticDrops = S(-0.5, 1.0, rainAmount) * 2.0 * uStaticDrops;
  float layer1 = S(0.25, 0.75, rainAmount);
  float layer2 = S(0.0, 0.5, rainAmount);
  float tFall = t * uFallSpeed;

  float wipeMask = texture(uTrail, uv).r;
  float wipe = wipeMask * clamp(uWipe, 0.0, 1.0);

  vec2 c = Drops(scaledUv, t, tFall, staticDrops, layer1, layer2, wipe);

  vec2 e = vec2(0.001, 0.0);
  float cx = Drops(scaledUv + e, t, tFall, staticDrops, layer1, layer2, wipe).x;
  float cy = Drops(scaledUv + e.yx, t, tFall, staticDrops, layer1, layer2, wipe).x;
  vec2 normal = vec2(cx - c.x, cy - c.x);

  vec2 e2 = vec2(0.012, 0.0);
  float wx = texture(uTrail, uv + e2).r;
  float wy = texture(uTrail, uv + e2.yx).r;
  normal += vec2(wipeMask - wx, wipeMask - wy) * 0.05 * uWipeDistort * clamp(uWipe, 0.0, 1.0);

  vec2 refractedUv = clamp(uv + normal * uRefraction, vec2(0.001), vec2(uMaxX - 0.004, 0.999));
  float fog = clamp(uBlur, 0.0, 8.0) * mix(0.7, 1.0, rainAmount);
  float back = fog * (1.0 - clamp(c.y * 2.0, 0.0, 1.0)) * (1.0 - wipe);
  float focus = mix(back, 0.0, S(0.1, 0.2, c.x));

  if (uHasContent < 0.5) {
    float mask = S(0.02, 0.14, c.x);
    vec3 n3 = normalize(vec3(normal * 42.0, 1.0));
    vec3 L = normalize(vec3(-0.35, 0.75, 0.55));
    float spec = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), n3), L), 0.0), 34.0);
    float rim = clamp(length(normal) * 26.0, 0.0, 1.0);
    vec3 dropCol = mix(vec3(0.72), uTint, clamp(uTintStrength, 0.0, 1.0));
    vec3 colF = dropCol * (0.12 + 0.5 * rim) + vec3(spec);
    float alphaF = mask * clamp(0.1 + rim * 0.5 + spec * 0.9, 0.0, 1.0);
    outColor = vec4(clamp(colF, 0.0, 1.0) * alphaF, alphaF);
    return;
  }

  vec4 content = textureLod(uContent, vec2(refractedUv.x, 1.0 - refractedUv.y), focus);
  vec3 col = content.rgb;

  col = mix(col, uTint, clamp(uTintStrength, 0.0, 1.0) * 0.35);

  vec2 vignetteUv = uv - 0.5;
  col *= 1.0 - dot(vignetteUv, vignetteUv) * clamp(uVignette, 0.0, 1.0) * 2.0;

  outColor = vec4(col * content.a, content.a);
}`,et=`#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uPrev;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform float uAspect;
uniform float uRadius;
uniform float uDecay;
uniform float uDrain;
uniform float uSplat;

float capsule (vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

void main () {
  float prev = max(texture(uPrev, vUv).r * uDecay - uDrain, 0.0);
  vec2 p = vec2(vUv.x * uAspect, vUv.y);
  vec2 a = vec2(uFrom.x * uAspect, uFrom.y);
  vec2 b = vec2(uTo.x * uAspect, uTo.y);
  float d = capsule(p, a, b);
  float m = smoothstep(uRadius, uRadius * 0.5, d) * uSplat;
  outColor = vec4(max(prev, m), 0.0, 0.0, 1.0);
}`;function Le(c,p={}){let t={...Qe,...p},{source:i,content:n,output:r}=c,e=r.getContext("webgl2",{alpha:!0,depth:!1,stencil:!1,antialias:!1,premultipliedAlpha:!0});if(!e||e.isContextLost())return null;let W=i.getContext("2d"),N=i,b=Boolean(W&&typeof W.drawElementImage==="function"&&typeof N.requestPaint==="function"),H=!1,me=()=>{};if(b)N.onpaint=()=>{try{W.reset(),W.drawElementImage(n,0,0),H=!0,me()}catch{}};function ve(u,v){let T=e.createShader(u);if(e.shaderSource(T,v),e.compileShader(T),!e.getShaderParameter(T,e.COMPILE_STATUS))console.error("Droplets shader error:",e.getShaderInfoLog(T));return T}let de=ve(e.VERTEX_SHADER,Ze),G=ve(e.FRAGMENT_SHADER,Je),C=ve(e.FRAGMENT_SHADER,et);function g(u){let v=e.createProgram();e.attachShader(v,de),e.attachShader(v,u),e.linkProgram(v);let T={},X=e.getProgramParameter(v,e.ACTIVE_UNIFORMS);for(let B=0;B<X;B++){let le=e.getActiveUniform(v,B);T[le.name]=e.getUniformLocation(v,le.name)}return{program:v,uniforms:T}}let{program:Ee,uniforms:h}=g(G),{program:k,uniforms:K}=g(C),ae=e.createBuffer();e.bindBuffer(e.ARRAY_BUFFER,ae),e.bufferData(e.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),e.STATIC_DRAW),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,0,0);let D=e.createTexture();e.bindTexture(e.TEXTURE_2D,D),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,new Uint8Array([0,0,0,0])),e.generateMipmap(e.TEXTURE_2D);let E=1;function f(){let u=Math.min(window.devicePixelRatio||1,2),v=Math.max(1,Math.round(r.clientWidth*u)),T=Math.max(1,Math.round(r.clientHeight*u));if(r.width!==v||r.height!==T)r.width=v,r.height=T;if(E=Math.min(1,Math.max(0.05,n.clientWidth/Math.max(r.clientWidth,1))),b){let X=Math.max(1,Math.round(i.clientWidth)),B=Math.max(1,Math.round(i.clientHeight));if(i.width!==X*u||i.height!==B*u)i.width=X*u,i.height=B*u;N.requestPaint()}}f();let S=0,he=0,F=[],R=[],ee=0;function O(){let u=Math.max(1,Math.round(r.width/4)),v=Math.max(1,Math.round(r.height/4));if(u===S&&v===he&&F.length)return;S=u,he=v;for(let T of F)e.deleteTexture(T);for(let T of R)e.deleteFramebuffer(T);F.length=0,R.length=0;for(let T=0;T<2;T++){let X=e.createTexture();e.bindTexture(e.TEXTURE_2D,X),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,u,v,0,e.RGBA,e.UNSIGNED_BYTE,null);let B=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,B),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,X,0),e.clearColor(0,0,0,1),e.clear(e.COLOR_BUFFER_BIT),F.push(X),R.push(B)}e.bindFramebuffer(e.FRAMEBUFFER,null)}let m={x:0.5,y:0.5,px:0.5,py:0.5,seen:!1,moved:!1};function z(u){O(),e.useProgram(k),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,F[ee]),e.uniform1i(K.uPrev,0),e.uniform1f(K.uDecay,Math.exp(-u*0.5)),e.uniform1f(K.uDrain,u*0.3),e.uniform1f(K.uAspect,r.width/Math.max(r.height,1)),e.uniform2f(K.uFrom,m.px,m.py),e.uniform2f(K.uTo,m.x,m.y),e.uniform1f(K.uRadius,Math.max(t.interactionRadius,0.01)),e.uniform1f(K.uSplat,t.interactive&&m.moved?1:0),e.bindFramebuffer(e.FRAMEBUFFER,R[1-ee]),e.viewport(0,0,S,he),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.bindFramebuffer(e.FRAMEBUFFER,null),ee=1-ee,m.px=m.x,m.py=m.y,m.moved=!1}function A(){if(!b||!H)return;H=!1,e.bindTexture(e.TEXTURE_2D,D),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,e.RGBA,e.UNSIGNED_BYTE,i),e.generateMipmap(e.TEXTURE_2D)}function ue(u){A(),e.useProgram(Ee),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,D),e.uniform1i(h.uContent,0),e.uniform1f(h.uHasContent,b?1:0),e.uniform2f(h.uResolution,r.width,r.height),e.uniform2f(h.uOffset,n.scrollLeft/Math.max(n.clientWidth,1),-n.scrollTop/Math.max(n.clientHeight,1)),e.uniform1f(h.uTime,u),e.uniform1f(h.uIntensity,t.intensity),e.uniform1f(h.uScale,Math.max(t.scale,0.01)),e.uniform1f(h.uDropWidth,Math.max(t.dropWidth,0.05)),e.uniform1f(h.uDropLength,Math.max(t.dropLength,0.05)),e.uniform1f(h.uRefraction,t.refraction),e.uniform1f(h.uBlur,Math.max(t.blur,0)),e.uniform1f(h.uVignette,t.vignette),e.uniform1f(h.uFallSpeed,t.fallSpeed),e.uniform1f(h.uWiggle,t.wiggle),e.uniform1f(h.uStaticDrops,t.staticDrops),e.uniform1f(h.uMaxX,E),e.activeTexture(e.TEXTURE1),e.bindTexture(e.TEXTURE_2D,F[ee]),e.uniform1i(h.uTrail,1),e.uniform1f(h.uWipe,t.interactive?Math.min(Math.max(t.interactionStrength,0),1):0),e.uniform1f(h.uWipeDistort,Math.max(t.interactionDistortion,0)),e.uniform3f(h.uTint,t.tint[0],t.tint[1],t.tint[2]),e.uniform1f(h.uTintStrength,t.tintStrength),e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,r.width,r.height),e.drawArrays(e.TRIANGLE_STRIP,0,4)}let V=0,L=performance.now(),w=0,q=!1,j=!1,fe=!0,ce=window.matchMedia("(prefers-reduced-motion: reduce)"),te=ce.matches;function xe(u){if(q)return;if(!fe){j=!1;return}let v=Math.min((u-L)/1000,0.03333333333333333);if(L=u,w+=v*t.speed,z(v),ue(w),te&&!H){j=!1;return}V=requestAnimationFrame(xe)}function I(){if(q||j||!fe)return;j=!0,L=performance.now(),V=requestAnimationFrame(xe)}me=I,I();function $(){te=ce.matches,I()}ce.addEventListener("change",$);let Q=new ResizeObserver(()=>{f(),I()});Q.observe(r),Q.observe(n);let re=new IntersectionObserver((u)=>{if(fe=u[u.length-1]?.isIntersecting??!0,fe)I()});re.observe(r);let oe=r.parentElement??r,ge=Me(r);function P(u){if(!t.interactive||te)return;let v=ge.current,T=(u.clientX-v.left)/Math.max(v.width,1),X=1-(u.clientY-v.top)/Math.max(v.height,1);if(!m.seen)m.seen=!0,m.px=T,m.py=X;m.x=T,m.y=X,m.moved=!0,I()}function Re(){m.seen=!1}return oe.addEventListener("pointermove",P,{passive:!0}),oe.addEventListener("pointerleave",Re,{passive:!0}),n.addEventListener("scroll",I,{passive:!0}),{setOptions(u){if(!Object.entries(u).some(([v,T])=>t[v]!==T))return;Object.assign(t,u),I()},resize(){f(),I()},destroy(){q=!0,ge.destroy(),cancelAnimationFrame(V),Q.disconnect(),re.disconnect(),ce.removeEventListener("change",$),oe.removeEventListener("pointermove",P),oe.removeEventListener("pointerleave",Re),n.removeEventListener("scroll",I),e.deleteTexture(D);for(let u of F)e.deleteTexture(u);for(let u of R)e.deleteFramebuffer(u);if(e.deleteProgram(Ee),e.deleteProgram(k),e.deleteShader(de),e.deleteShader(G),e.deleteShader(C),e.deleteBuffer(ae),b)N.onpaint=null}}}var Te=(c)=>document.getElementById(c);function tt(){let c=Te("heroCloudRegion"),p=Te("heroCloudCanvas"),t=Te("heroCloudSource");if(!c||!p||!t)return null;return Fe({source:t,content:c,output:p},{scale:0.78,speed:0.34,cover:0.035,density:2.15,shading:0.24,color:[0.44,0.45,0.5],opacity:0.34,shadow:0.1,shadowOffsetX:34,shadowOffsetY:16,shadowSoftness:1,wind:0.42,windRadius:260,refraction:0,fogBlur:0,quality:0.46})}function rt(){let c=Te("heroFrostPanel"),p=Te("heroFrostCanvas"),t=Te("heroFrostSource");if(!c||!p||!t)return null;let i=Ce({source:t,content:c,output:p},{frost:0.022,strength:0.32,contrast:1.55,crispness:0.52,highlight:0.06,highlightStrength:0.3,haze:0.05,tintThin:[0.76,0.82,0.94],tintThick:[0.92,0.95,1],tintStrength:0.06,saturation:0.92,brightness:0.6,refraction:0.38,ior:1.31,detail:1.15,textureScale:1.3,fresnel:0.62,meltRadius:0.22,meltNoise:0.28,meltStrength:0.58,refreeze:1.65,edgeFade:0.14,meltEdges:!1,introDuration:1.8,opacity:0.22,shimmer:0.018,quality:0.48});return c.classList.toggle("has-frost-webgl",Boolean(i)),i}function ot(c,p,t,i){let n=Math.min(t/p.naturalWidth,i/p.naturalHeight),r=p.naturalWidth*n,e=p.naturalHeight*n;c.clearRect(0,0,t,i),c.drawImage(p,(t-r)/2,i-e,r,e)}async function nt(){let c=Te("canStage"),p=Te("canDropletsCanvas"),t=Te("canDropletsSource"),i=c?.querySelector(".layer-can");if(!c||!p||!t||!i)return null;if(!i.complete||!i.naturalWidth)await new Promise((n)=>{i.addEventListener("load",n,{once:!0}),i.addEventListener("error",n,{once:!0})});if(!i.naturalWidth)return null;if(location.protocol!=="file:"){let n=t.getContext("2d");if(!n)return null;n.drawElementImage=()=>ot(n,i,t.width,t.height),t.requestPaint=()=>t.onpaint?.(),p.style.webkitMask='url("/landing/assets/new_can.png") center bottom / contain no-repeat',p.style.mask='url("/landing/assets/new_can.png") center bottom / contain no-repeat'}return Le({source:t,content:c,output:p},{intensity:0.52,speed:0.82,scale:0.58,dropWidth:0.9,dropLength:1.05,refraction:0.16,blur:0,vignette:0,fallSpeed:0.72,wiggle:0.78,staticDrops:0.3,interactive:!1,interactionRadius:0.2,interactionStrength:0,interactionDistortion:0,tint:[1,1,1],tintStrength:0})}var Ie=[tt(),rt()].filter(Boolean);nt().then((c)=>{if(c)Ie.push(c)});window.addEventListener("pagehide",()=>Ie.forEach((c)=>c.destroy()),{once:!0});})();
