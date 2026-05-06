#!/usr/bin/env bun
/**
 * opentui-glyphfit — comparison demo
 *
 * Left:  OpenTUI drawGrayscaleBufferSupersampled (built-in, density-only)
 * Right: opentui-glyphfit (6-point spatial sample → charset match)
 *
 * PRIMARY MODES (c to cycle):
 *   Plasma · Ripples · Diagonal waves · Checkers · Sphere · Torus · Gem (smooth)
 *
 * Procedural patterns are the clearest demonstration — they have sub-cell
 * frequency variation so every cell's ShapeVector is unique. Flat-shaded 3D
 * geometry inevitably produces uniform ShapeVectors within each face
 * (identical chars = horizontal stripes). Smooth 3D (sphere, torus, smooth gem)
 * avoids this because the normal varies per-pixel.
 *
 * Architecture: FrameBufferRenderable + setFrameCallback (OpenTUI-native pattern,
 * no requestLive/addPostProcessFn hacks).
 *
 * ── Controls ──────────────────────────────────────────────────────────────────
 *  q / Ctrl-C  quit       p  pause / resume    h  toggle HUD
 *  c           cycle mode  b  cycle charset
 *
 *  Camera / geometry   f/F  FOV  ·  z/Z  cam Z
 *  Lighting            k/K  key  ·  i/I  fill  ·  r/R  rim  ·  s/S  spec
 *  Post-process        g/G  gamma  ·  m/M  min-hit  ·  t/T  threshold
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { createCliRenderer, RGBA, CliRenderEvents, FrameBufferRenderable } from "@opentui/core"
import { drawGlyphFit, BRAILLE, BLOCKS_SHADE, BLOCKS, BOX, ASCII, StickyMatcher, renderAllFormats } from "../src/index.ts"
import { writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import type { Charset } from "../src/types.ts"

// ─── Vec3 ─────────────────────────────────────────────────────────────────────

interface V3 { x:number; y:number; z:number }
const v3    = (x:number,y:number,z:number):V3 => ({x,y,z})
const add   = (a:V3,b:V3):V3 => v3(a.x+b.x,a.y+b.y,a.z+b.z)
const sub   = (a:V3,b:V3):V3 => v3(a.x-b.x,a.y-b.y,a.z-b.z)
const scale = (a:V3,s:number):V3 => v3(a.x*s,a.y*s,a.z*s)
const dot   = (a:V3,b:V3):number => a.x*b.x+a.y*b.y+a.z*b.z
const len   = (a:V3):number => Math.sqrt(dot(a,a))
const norm  = (a:V3):V3 => { const l=len(a)||1; return scale(a,1/l) }
const rotY  = (v:V3,a:number):V3 => v3(v.x*Math.cos(a)+v.z*Math.sin(a),v.y,-v.x*Math.sin(a)+v.z*Math.cos(a))
const rotX  = (v:V3,a:number):V3 => v3(v.x,v.y*Math.cos(a)-v.z*Math.sin(a),v.y*Math.sin(a)+v.z*Math.cos(a))

// ─── Procedural patterns ──────────────────────────────────────────────────────
// High-frequency functions that vary WITHIN a terminal cell → asymmetric
// ShapeVectors → glyphfit selects directional chars, not just density chars.

function plasma(x:number,y:number,w:number,h:number,t:number):number {
  const nx=x/w, ny=y/h
  const v1=Math.sin(nx*14+t)
  const v2=Math.sin(ny*14+t*0.7)
  const v3=Math.sin((nx+ny)*11+t*1.3)
  const v4=Math.sin(Math.sqrt((nx-.5)**2+(ny-.5)**2)*18-t*2)
  return (v1+v2+v3+v4+4)/8
}

function ripples(x:number,y:number,w:number,h:number,t:number):number {
  const asp=w/h/2, dx=x/w-.5, dy=(y/h-.5)/asp
  const d=Math.sqrt(dx*dx+dy*dy)
  return (Math.sin(d*24-t*4)+1)/2*(1-Math.min(d*1.8,1))
}

function waves(x:number,y:number,w:number,h:number,t:number):number {
  const nx=x/w, ny=y/h
  return ((Math.sin((nx-ny)*20+t*3)+Math.sin((nx+ny)*15-t*2)+2)/4)
}

function checkers(x:number,y:number,w:number,h:number,t:number):number {
  const cx=w/2, cy=h/2
  const co=Math.cos(t*.25), si=Math.sin(t*.25)
  const rx=(x-cx)*co-(y-cy)*si, ry=(x-cx)*si+(y-cy)*co
  const sz=Math.min(w,h)/7
  return (Math.floor(rx/sz)+Math.floor(ry/sz))%2===0?1:0
}

const PROC_FNS = [plasma, ripples, waves, checkers]

function genProcField(mode:number, t:number, srcW:number, srcH:number, termW:number, termH:number): Float32Array {
  const buf = new Float32Array(srcW * srcH)
  const fn = PROC_FNS[mode % PROC_FNS.length]!
  for (let y=0; y<srcH; y++)
    for (let x=0; x<srcW; x++)
      buf[y*srcW+x] = fn(x, y, srcW, srcH, t)
  return buf
}

// ─── 3D shapes ────────────────────────────────────────────────────────────────

function sphereHit(o:V3,d:V3):{t:number;n:V3}|null {
  const b2=dot(o,d), c=dot(o,o)-1, disc=b2*b2-dot(d,d)*c
  if (disc<0) return null
  const t=(-b2-Math.sqrt(disc))/dot(d,d)
  if (t<1e-4) return null
  return {t, n:norm(add(o,scale(d,t)))}
}

function torusSDF(p:V3,R=0.75,r=0.32):number {
  const q=v3(Math.sqrt(p.x*p.x+p.z*p.z)-R,p.y,0)
  return len(q)-r
}

function torusHit(o:V3,d:V3):{t:number;n:V3}|null {
  const dN=scale(d,1/len(d)); let t=0
  for (let i=0;i<80;i++) {
    const p=add(o,scale(dN,t)), dist=torusSDF(p)
    if (dist<0.002) {
      const eps=0.001
      const nx=torusSDF(v3(p.x+eps,p.y,p.z))-torusSDF(v3(p.x-eps,p.y,p.z))
      const ny=torusSDF(v3(p.x,p.y+eps,p.z))-torusSDF(v3(p.x,p.y-eps,p.z))
      const nz=torusSDF(v3(p.x,p.y,p.z+eps))-torusSDF(v3(p.x,p.y,p.z-eps))
      return {t:t/len(d), n:norm(v3(nx,ny,nz))}
    }
    if (dist>5||t>12) break
    t+=Math.max(dist,0.01)
  }
  return null
}

// Gem (smooth Phong — no flat faces, no banding)
const N=8, GEM_SY=0.75, TR=0.42, TY=0.72*GEM_SY, GR=1.0, GY=0.05, CY=-1.0*GEM_SY
function buildGem() {
  const base:V3[]=[v3(0,TY,0)]
  for (let i=0;i<N;i++){const a=(i/N)*Math.PI*2;base.push(v3(TR*Math.cos(a),TY,TR*Math.sin(a)))}
  for (let i=0;i<N;i++){const a=((i+.5)/N)*Math.PI*2;base.push(v3(GR*Math.cos(a),GY,GR*Math.sin(a)))}
  base.push(v3(0,CY,0))
  const verts=base.map(v=>rotX(v,0.15))
  const faces:[number,number,number][]=[]
  for (let i=0;i<N;i++) faces.push([0,1+i,1+(i+1)%N])
  for (let i=0;i<N;i++) faces.push([1+i,1+(i+1)%N,N+1+i])
  for (let i=0;i<N;i++) faces.push([N+1+i,N+1+(i+1)%N,2*N+1])
  return {verts,faces}
}
const GEM_BASE=buildGem()

function computeVN(verts:V3[],faces:[number,number,number][]): V3[] {
  const vn:V3[]=verts.map(()=>v3(0,0,0))
  for (const [i0,i1,i2] of faces) {
    const e1=sub(verts[i1]!,verts[i0]!),e2=sub(verts[i2]!,verts[i0]!)
    const fn=v3(e1.y*e2.z-e1.z*e2.y,e1.z*e2.x-e1.x*e2.z,e1.x*e2.y-e1.y*e2.x)
    const l=len(fn)||1
    for (const i of [i0,i1,i2]) { vn[i]!.x+=fn.x/l; vn[i]!.y+=fn.y/l; vn[i]!.z+=fn.z/l }
  }
  return vn.map(n=>norm(n))
}

function rayTri(o:V3,d:V3,v0:V3,v1:V3,v2:V3):{t:number;u:number;v:number}|null {
  const e1=sub(v1,v0),e2=sub(v2,v0),h=v3(d.y*e2.z-d.z*e2.y,d.z*e2.x-d.x*e2.z,d.x*e2.y-d.y*e2.x)
  const a=dot(e1,h); if(Math.abs(a)<1e-8)return null
  const f=1/a,s=sub(o,v0),u=f*dot(s,h); if(u<0||u>1)return null
  const q=v3(s.y*e1.z-s.z*e1.y,s.z*e1.x-s.x*e1.z,s.x*e1.y-s.y*e1.x),v=f*dot(d,q); if(v<0||u+v>1)return null
  const t=f*dot(e2,q); return t>1e-4?{t,u,v}:null
}

function gemHit(verts:V3[],faces:[number,number,number][],vn:V3[],o:V3,d:V3):{t:number;n:V3}|null {
  const oc=sub(o,v3(0,(TY+CY)/2,0)),oc2=dot(oc,oc)-(GR*1.8)**2
  const a=dot(d,d),b2=dot(oc,d)
  if (b2*b2-a*oc2<0) return null
  let bestT=Infinity,bestFi=-1,bestU=0,bestV=0
  for (let fi=0;fi<faces.length;fi++){
    const [i0,i1,i2]=faces[fi]!
    const r=rayTri(o,d,verts[i0]!,verts[i1]!,verts[i2]!)
    if(r&&r.t<bestT){bestT=r.t;bestFi=fi;bestU=r.u;bestV=r.v}
  }
  if(bestFi<0)return null
  const [i0,i1,i2]=faces[bestFi]!
  const w=1-bestU-bestV
  const vn0=vn[i0]!,vn1=vn[i1]!,vn2=vn[i2]!
  return {t:bestT, n:norm(v3(w*vn0.x+bestU*vn1.x+bestV*vn2.x, w*vn0.y+bestU*vn1.y+bestV*vn2.y, w*vn0.z+bestU*vn1.z+bestV*vn2.z))}
}

function shade(n:V3,ray:V3,p:Params,keyOverride?:V3):number {
  const KEY=keyOverride??norm(v3(1.3,2.0,-0.8))
  const FILL=norm(v3(-0.9,0.6,1.0))
  const vdir=scale(ray,-1)
  const fn=dot(n,ray)>0?scale(n,-1):n
  const diffK=Math.max(0,dot(fn,KEY))
  const reflK=sub(scale(fn,2*dot(fn,vdir)),vdir)
  const specK=Math.pow(Math.max(0,dot(reflK,KEY)),p.specPow)*p.specStr
  const diffF=Math.max(0,dot(fn,FILL))*p.fillStr
  const rim=Math.pow(1-Math.max(0,dot(fn,vdir)),4)*p.rimStr
  return Math.max(p.minHit,Math.min(1,0.07+diffK*p.keyStr+specK+diffF+rim))
}

function gen3DField(mode:number, angle:number, srcW:number, srcH:number, p:Params): Float32Array {
  const buf=new Float32Array(srcW*srcH)
  const cam=v3(0,0.1,p.camZ), F=p.fov, asp=(srcW/srcH)*0.5
  const tilt=angle*0.25

  // Gem-smooth: rotate vertices
  const gemVerts = mode===2 ? GEM_BASE.verts.map(v=>rotX(rotY(v,angle),tilt)) : []
  const gemVN    = mode===2 ? computeVN(gemVerts, GEM_BASE.faces) : []

  for (let py=0;py<srcH;py++) {
    const ny=(0.5-py/srcH)*F
    for (let px=0;px<srcW;px++) {
      const nx=(px/srcW-0.5)*F*asp
      const D=v3(nx,ny,1)
      let intensity=0

      if (mode===0) { // sphere
        const rk=norm(rotY(v3(1.3,2.0,-0.8),angle))
        const hit=sphereHit(sub(cam,v3(0,0,0)),D)
        if(!hit)continue
        intensity=shade(hit.n,norm(D),p,rk)
      } else if (mode===1) { // torus
        const camR=rotX(rotY(cam,-angle),-tilt), dR=rotX(rotY(D,-angle),-tilt)
        const hit=torusHit(camR,dR)
        if(!hit)continue
        intensity=shade(rotY(rotX(hit.n,tilt),angle),norm(D),p)
      } else if (mode===2) { // gem-smooth
        const hit=gemHit(gemVerts,GEM_BASE.faces,gemVN,cam,D)
        if(!hit)continue
        intensity=shade(hit.n,norm(D),p)
      }
      buf[py*srcW+px]=intensity
    }
  }
  for (let i=0;i<buf.length;i++)
    if(buf[i]!>0) buf[i]=Math.pow(buf[i]!,p.gamma)
  return buf
}

// ─── Params ───────────────────────────────────────────────────────────────────

interface Params {
  modeIdx:    number   // 0-3 proc, 4-6 3D
  charsetIdx: number
  fov:        number
  camZ:       number
  keyStr:     number
  fillStr:    number
  rimStr:     number
  specPow:    number
  specStr:    number
  gamma:      number
  minHit:     number
  thresh:     number
  showHud:    boolean
  paused:     boolean
}

const P: Params = {
  modeIdx:    0,     // Plasma — best for first impression
  charsetIdx: 0,     // BLOCKS+SHADE
  fov:    0.60,
  camZ:  -4.0,
  keyStr: 0.65,
  fillStr:0.35,
  rimStr: 0.90,
  specPow:36,
  specStr:0.40,
  gamma:  0.65,
  minHit: 0.22,
  thresh: 0.04,
  showHud:true,
  paused: false,
}

const MODES = [
  'Plasma',  'Ripples',    'Waves',  'Checkers',   // procedural (no banding)
  'Sphere',  'Torus',      'Gem (smooth)',          // 3D smooth (no banding)
]

const CHARSETS: {name:string; cs:Charset}[] = [
  {name:'BLOCKS+SHADE', cs:BLOCKS_SHADE},
  {name:'BRAILLE(256)', cs:BRAILLE},
  {name:'BOX(21)',       cs:BOX},
  {name:'ASCII(95)',     cs:ASCII},
]

// ─── Dirty-cell tracker ───────────────────────────────────────────────────────

class Dirty {
  private prev=new Uint8Array(0); private curr=new Uint8Array(0); private W=0
  resize(w:number,h:number){const n=w*h;if(this.prev.length!==n){this.prev=new Uint8Array(n);this.curr=new Uint8Array(n);this.W=w}}
  mark(x:number,y:number){if(x<this.W&&y*this.W+x<this.curr.length)this.curr[y*this.W+x]=1}
  erase(buf:import("@opentui/core").OptimizedBuffer,ox:number,oy:number,w:number,h:number,bg:RGBA){
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*this.W+x;if(this.prev[i]&&!this.curr[i])buf.drawChar(0x20,ox+x,oy+y,bg,bg)}
  }
  swap(){const t=this.prev;this.prev=this.curr;this.curr=t;this.curr.fill(0)}
}

// ─── HUD ──────────────────────────────────────────────────────────────────────

const clamp = (v:number,lo:number,hi:number) => Math.max(lo,Math.min(hi,v))
const step  = (v:number,d:number,lo:number,hi:number,dp=2) => {
  const s=Math.pow(10,dp); return clamp(Math.round((v+d)*s)/s,lo,hi)
}

function buildHud(p:Params,W:number):string {
  const cs=CHARSETS[p.charsetIdx]!.name, md=MODES[p.modeIdx]!
  const r1=` [f/F]fov:${p.fov.toFixed(2)} [z/Z]cam:${p.camZ.toFixed(1)} [k/K]key:${p.keyStr.toFixed(2)} [i/I]fill:${p.fillStr.toFixed(2)} [r/R]rim:${p.rimStr.toFixed(2)} [s/S]spec:${p.specPow}  [b]${cs}  [c]${md}`
  const r2=` [g/G]γ:${p.gamma.toFixed(2)} [m/M]min:${p.minHit.toFixed(2)} [t/T]thresh:${p.thresh.toFixed(2)}  [h]=hud  [p]=${p.paused?'PAUSED':'play'}  [q]=quit`
  return r1.padEnd(W).slice(0,W)+'\n'+r2.padEnd(W).slice(0,W)
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const renderer = await createCliRenderer({ targetFps: 30, exitOnCtrlC: true })

  let time  = 0
  let angle = 0
  let fbRenderable: FrameBufferRenderable | null = null

  // Create initial FrameBufferRenderable
  function makeOrResizeFB(W:number, H:number) {
    if (!fbRenderable) {
      fbRenderable = new FrameBufferRenderable(renderer, { id:"gf-demo", width:W, height:H, zIndex:0 })
      renderer.root.add(fbRenderable)
    } else {
      fbRenderable.frameBuffer.resize(W, H)
    }
  }
  makeOrResizeFB(renderer.terminalWidth, renderer.terminalHeight)

  const FG     = RGBA.fromValues(0.80,0.93,1.00,1)
  const BG     = RGBA.fromValues(0,   0,   0,   1)
  const FG_HUD = RGBA.fromValues(0.50,0.50,0.50,1)
  const FG_LAB = RGBA.fromValues(1,   1,   1,   1)
  const FG_DIV = RGBA.fromValues(0.25,0.25,0.25,1)
  const BG_LH  = RGBA.fromValues(0.12,0.12,0.12,1)
  const BG_RH  = RGBA.fromValues(0.00,0.09,0.22,1)

  process.stdin.setRawMode?.(true)
  process.stdin.resume()
  process.stdin.setEncoding("utf8")
  process.stdin.on("data", (key:string) => {
    switch(key) {
      case 'q': case '\x03': renderer.destroy(); process.exit(0)
      case 'p': P.paused=!P.paused; break
      case 'h': P.showHud=!P.showHud; break
      case 'b': P.charsetIdx=(P.charsetIdx+1)%CHARSETS.length; sticky.reset(); break
      case 'c': P.modeIdx=(P.modeIdx+1)%MODES.length; break
      case 's': saveScreenshot(); break
      case 'f': P.fov=step(P.fov,-0.05,0.10,2.00); break; case 'F': P.fov=step(P.fov,+0.05,0.10,2.00); break
      case 'z': P.camZ=step(P.camZ,+0.25,-10,-1.0); break; case 'Z': P.camZ=step(P.camZ,-0.25,-10,-1.0); break
      case 'k': P.keyStr=step(P.keyStr,-0.05,0,2); break; case 'K': P.keyStr=step(P.keyStr,+0.05,0,2); break
      case 'i': P.fillStr=step(P.fillStr,-0.05,0,1); break; case 'I': P.fillStr=step(P.fillStr,+0.05,0,1); break
      case 'r': P.rimStr=step(P.rimStr,-0.05,0,2); break; case 'R': P.rimStr=step(P.rimStr,+0.05,0,2); break
      case 's': P.specPow=clamp(P.specPow-4,1,512); break; case 'S': P.specPow=clamp(P.specPow+4,1,512); break
      case 'g': P.gamma=step(P.gamma,-0.05,0.20,3.0); break; case 'G': P.gamma=step(P.gamma,+0.05,0.20,3.0); break
      case 'm': P.minHit=step(P.minHit,-0.02,0,0.5); break; case 'M': P.minHit=step(P.minHit,+0.02,0,0.5); break
      case 't': P.thresh=step(P.thresh,-0.01,0,0.2); break; case 'T': P.thresh=step(P.thresh,+0.01,0,0.2); break
    }
  })

  renderer.on(CliRenderEvents.RESIZE, () => {
    makeOrResizeFB(renderer.terminalWidth, renderer.terminalHeight)
  })

  const ld=new Dirty(), rd=new Dirty()
  let lastW=0, lastH=0
  // Reused 2× grayscale buffer for the built-in renderer (left panel).
  let leftBuf = new Float32Array(0)
  // Frame-to-frame char hysteresis to suppress shimmer at Voronoi boundaries.
  const sticky = new StickyMatcher({ tolerance: 0.04 })
  let prevCharsetIdx = -1

  // Transient toast for the [s] save indicator (rendered into the right header).
  let toast: { msg: string; until: number } | null = null
  let lastRender: {
    intensities: Float32Array
    srcWidth: number; srcHeight: number
    destWidth: number; destHeight: number
    charset: import("../src/types.ts").Charset
    csName: string; modeName: string
  } | null = null
  const SCREENSHOT_DIR = process.env.GLYPHFIT_SCREENSHOT_DIR ?? "screenshots"
  function saveScreenshot(): void {
    if (!lastRender) {
      toast = { msg: "\u26a0  nothing to capture yet", until: Date.now() + 2000 }
      return
    }
    try {
      mkdirSync(SCREENSHOT_DIR, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19)
      const tag = `${lastRender.modeName.replace(/\s+/g, "-")}_${lastRender.csName}`
      const base = `comparison_${tag}_${stamp}`
      const out = renderAllFormats({
        intensities: lastRender.intensities,
        srcWidth: lastRender.srcWidth, srcHeight: lastRender.srcHeight,
        destWidth: lastRender.destWidth, destHeight: lastRender.destHeight,
        fg: FG, bg: BG, charset: lastRender.charset,
      }, { title: `glyphfit \u2014 ${lastRender.modeName} \u2014 ${lastRender.csName}` })
      writeFileSync(join(SCREENSHOT_DIR, base + ".txt"),      out.txt)
      writeFileSync(join(SCREENSHOT_DIR, base + ".ansi.txt"), out.ansi)
      writeFileSync(join(SCREENSHOT_DIR, base + ".html"),     out.html)
      toast = {
        msg: `\u2713 saved \u2192 ${SCREENSHOT_DIR}/${base}.{txt,ansi.txt,html}`,
        until: Date.now() + 4000,
      }
    } catch (e) {
      toast = { msg: `\u2717 ${(e as Error).message}`, until: Date.now() + 4000 }
    }
  }

  // Restore terminal state on any exit path so raw-mode stdin isn't left stuck.
  const cleanup = () => {
    try { process.stdin.setRawMode?.(false); process.stdin.pause() } catch {}
    try { renderer.destroy() } catch {}
  }
  process.on("exit", cleanup)
  process.on("SIGINT",  () => { cleanup(); process.exit(130) })
  process.on("SIGTERM", () => { cleanup(); process.exit(143) })
  process.on("uncaughtException", (e) => { cleanup(); console.error(e); process.exit(1) })

  renderer.setFrameCallback(async (deltaTime) => {
    if (!P.paused) {
      time  += deltaTime/1000 * 0.8
      angle += deltaTime/1000 * 0.4
    }

    if (!fbRenderable) return
    const buffer = fbRenderable.frameBuffer
    const W=buffer.width, H=buffer.height
    if (W<8||H<6) return

    const DIV    = Math.floor(W/2)
    const LEFT_W = DIV
    const RIGHT_W= W-DIV-1
    const HUD_H  = P.showHud ? 2 : 0
    const GEM_TOP= 2
    const GEM_H  = Math.max(1, H-3-HUD_H)

    const sized = W!==lastW||H!==lastH
    if (sized) { lastW=W; lastH=H }

    ld.resize(LEFT_W, GEM_H)
    rd.resize(RIGHT_W, GEM_H)

    // ── Chrome ────────────────────────────────────────────────────────────
    if (sized) {
      buffer.clear(BG)
      for (let r=0;r<H;r++) buffer.drawChar(0x2502,DIV,r,FG_DIV,BG)
      buffer.drawText(("─".repeat(LEFT_W)+"┼"+"─".repeat(RIGHT_W)).slice(0,W),0,1,FG_DIV,BG)
      buffer.drawText(
        " drawGrayscaleBufferSupersampled  (OpenTUI built-in)".slice(0,LEFT_W).padEnd(LEFT_W),
        0,0,FG_LAB,BG_LH)
    }
    // Right header — toast takes priority for ~4s after a save.
    const showToast = toast !== null && Date.now() < toast.until
    const rh = showToast
      ? ` ${toast!.msg}`
      : ` glyphfit — ${CHARSETS[P.charsetIdx]!.name}  mode: ${MODES[P.modeIdx]!}  [b]=charset  [c]=mode  [s]=save`
    const rhBg = showToast ? RGBA.fromValues(0, 0.25, 0.05, 1) : BG_RH
    buffer.drawText(rh.slice(0,RIGHT_W).padEnd(RIGHT_W),DIV+1,0,FG_LAB,rhBg)

    // ── HUD ───────────────────────────────────────────────────────────────
    if (P.showHud) {
      const hudY=H-1-HUD_H
      buildHud(P,W).split('\n').forEach((line,i)=>
        buffer.drawText(line.padEnd(W).slice(0,W),0,hudY+i,FG_HUD,BG))
    } else {
      buffer.drawText("  [h]=show-hud  [q]=quit  [p]=pause  [b]=charset  [c]=mode".padEnd(W).slice(0,W),0,H-1,FG_HUD,BG)
    }

    // ── Generate intensity field ───────────────────────────────────────────
    // 3× supersample so every glyphfit sub-region (top/mid/bot × left/right)
    // gets pixels via area weighting. Same field powers both panels.
    const PANEL_W = Math.max(LEFT_W, RIGHT_W)
    const srcW = PANEL_W * 3, srcH = GEM_H * 3
    const isProc = P.modeIdx < 4
    const field = isProc
      ? genProcField(P.modeIdx, time, srcW, srcH, PANEL_W, GEM_H)
      : gen3DField(P.modeIdx - 4, angle, srcW, srcH, P)

    // ── Erase stale cells ─────────────────────────────────────────────────
    ld.erase(buffer,0,         GEM_TOP,LEFT_W, GEM_H,BG)
    rd.erase(buffer,DIV+1,     GEM_TOP,RIGHT_W,GEM_H,BG)

    // ── Left: OpenTUI built-in ────────────────────────────────────────────
    // resample 3× source → 2× LEFT_W for the built-in renderer
    const lw2 = LEFT_W * 2, lh2 = GEM_H * 2
    if (leftBuf.length !== lw2 * lh2) leftBuf = new Float32Array(lw2 * lh2)
    for (let y = 0; y < lh2; y++) {
      const sy = Math.floor((y / lh2) * srcH)
      for (let x = 0; x < lw2; x++) {
        const sx = Math.floor((x / lw2) * srcW)
        leftBuf[y * lw2 + x] = field[sy * srcW + sx]!
      }
    }
    buffer.drawGrayscaleBufferSupersampled(0, GEM_TOP, leftBuf, lw2, lh2, FG, null)

    // ── Right: glyphfit ───────────────────────────────────────────────────
    const {cs}=CHARSETS[P.charsetIdx]!
    if (P.charsetIdx !== prevCharsetIdx) { sticky.reset(); prevCharsetIdx = P.charsetIdx }
    sticky.resize(RIGHT_W, GEM_H)
    drawGlyphFit(buffer, {
      intensities: field, srcWidth: srcW, srcHeight: srcH,
      x: DIV + 1, y: GEM_TOP,
      destWidth: RIGHT_W, destHeight: GEM_H,
      fg: FG, bg: BG,
      charset: cs, gamma: 1.0, threshold: P.thresh,
      sticky,
    })

    // Cache the inputs so [s] can re-render the right panel to text/HTML/ANSI.
    lastRender = {
      intensities: field, srcWidth: srcW, srcHeight: srcH,
      destWidth: RIGHT_W, destHeight: GEM_H,
      charset: cs,
      csName: CHARSETS[P.charsetIdx]!.name,
      modeName: MODES[P.modeIdx]!,
    }

    // ── Dirty tracking ────────────────────────────────────────────────────
    const litThresh = Math.max(P.thresh, 0.02)
    for (let cy = 0; cy < GEM_H; cy++) {
      for (let cx = 0; cx < PANEL_W; cx++) {
        const sx0 = cx * 3, sy0 = cy * 3
        let lit = false
        for (let dy = 0; dy < 3 && !lit; dy++)
          for (let dx = 0; dx < 3 && !lit; dx++)
            if ((field[(sy0 + dy) * srcW + (sx0 + dx)] ?? 0) > litThresh) lit = true
        if (lit) {
          if (cx < LEFT_W)  ld.mark(cx, cy)
          if (cx < RIGHT_W) rd.mark(cx, cy)
        }
      }
    }
    ld.swap(); rd.swap()
  })

  renderer.start()
}

main().catch(err=>{ console.error(err); process.exit(1) })
