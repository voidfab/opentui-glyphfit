#!/usr/bin/env bun
/** Quick headless verify — plasma and ripples at a few times. */

import { createTestRenderer } from "@opentui/core/testing"
import { RGBA } from "@opentui/core"
import { drawGlyphFit, BLOCKS_SHADE, BRAILLE } from "../src/index.ts"

function plasma(x:number,y:number,w:number,h:number,t:number):number{
  const nx=x/w,ny=y/h
  return ((Math.sin(nx*14+t)+Math.sin(ny*14+t*.7)+Math.sin((nx+ny)*11+t*1.3)+Math.sin(Math.sqrt((nx-.5)**2+(ny-.5)**2)*18-t*2)+4)/8)
}
function ripples(x:number,y:number,w:number,h:number,t:number):number{
  const asp=w/h/2,dx=x/w-.5,dy=(y/h-.5)/asp,d=Math.sqrt(dx*dx+dy*dy)
  return (Math.sin(d*24-t*4)+1)/2*(1-Math.min(d*1.8,1))
}

async function check(label:string,fn:(x:number,y:number,w:number,h:number,t:number)=>number,t:number,W=100,H=28){
  const RW=W*2
  const{renderer,renderOnce,captureCharFrame}=await createTestRenderer({width:RW,height:H})
  const FG=RGBA.fromValues(0.8,0.93,1,1),BG=RGBA.fromValues(0,0,0,1)
  const DIV=Math.floor(RW/2),LEFT_W=DIV,RIGHT_W=RW-DIV-1
  const GEM_TOP=1,GEM_H=H-2
  const PANEL_W=Math.max(LEFT_W,RIGHT_W)
  const srcW=PANEL_W*3,srcH=GEM_H*3
  const field=new Float32Array(srcW*srcH)
  for(let y=0;y<srcH;y++) for(let x=0;x<srcW;x++) field[y*srcW+x]=fn(x,y,srcW,srcH,t)
  
  // Measure intra-cell variance over the full 3×3 source neighbourhood per cell.
  let totalVariance=0,count=0
  for(let cy=0;cy<GEM_H;cy++){
    for(let cx=0;cx<PANEL_W;cx++){
      const sx0=cx*3,sy0=cy*3
      let sum=0
      for(let dy=0;dy<3;dy++) for(let dx=0;dx<3;dx++) sum+=field[(sy0+dy)*srcW+(sx0+dx)]!
      const avg=sum/9
      let v=0
      for(let dy=0;dy<3;dy++) for(let dx=0;dx<3;dx++) {
        const d=field[(sy0+dy)*srcW+(sx0+dx)]!-avg
        v+=d*d
      }
      totalVariance+=v/9; count++
    }
  }
  const avgVar=(totalVariance/count).toFixed(4)

  renderer.addPostProcessFn(buf=>{
    buf.clear(BG)
    const lw2=LEFT_W*2,lh2=GEM_H*2
    const lf=new Float32Array(lw2*lh2)
    for(let y=0;y<lh2;y++) for(let x=0;x<lw2;x++) {
      const sy=Math.floor((y/lh2)*srcH), sx=Math.floor((x/lw2)*srcW)
      lf[y*lw2+x]=field[sy*srcW+sx]!
    }
    buf.drawGrayscaleBufferSupersampled(0,GEM_TOP,lf,lw2,lh2,FG,null)
    drawGlyphFit(buf,{intensities:field,srcWidth:srcW,srcHeight:srcH,x:DIV+1,y:GEM_TOP,destWidth:RIGHT_W,destHeight:GEM_H,fg:FG,bg:BG,charset:BLOCKS_SHADE,gamma:1.0,threshold:0.02})
    buf.drawChar(0x2502,DIV,0,FG,BG)
    buf.drawText(label.padEnd(LEFT_W).slice(0,LEFT_W),0,0,FG,BG)
    buf.drawText(`glyphfit BLOCKS+SHADE  avg_cell_variance=${avgVar}`.padEnd(RIGHT_W).slice(0,RIGHT_W),DIV+1,0,FG,BG)
  })
  renderer.requestLive();await renderOnce()
  const frame=captureCharFrame()
  renderer.destroy()
  console.log(`\n${'─'.repeat(RW)}`)
  console.log(`${label}  t=${t.toFixed(2)}  avg_cell_variance=${avgVar}  (higher = more directional diversity)`)
  console.log('─'.repeat(RW))
  console.log(frame)
}

async function main(){
  await check('Plasma   t=0.5', plasma, 0.5)
  await check('Plasma   t=2.0', plasma, 2.0)
  await check('Ripples  t=1.0', ripples, 1.0)
}
main().catch(err=>{console.error(err);process.exit(1)})
