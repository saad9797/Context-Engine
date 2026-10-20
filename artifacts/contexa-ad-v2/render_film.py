from pathlib import Path
from playwright.sync_api import sync_playwright
from PIL import Image,ImageDraw
from io import BytesIO
import subprocess, json, argparse
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--preview',action='store_true');ap.add_argument('--fps',type=int,default=30);opt=ap.parse_args()
    ff=imageio_ffmpeg.get_ffmpeg_exe()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,args=['--allow-file-access-from-files','--disable-web-security'])
        page=browser.new_page(viewport={'width':1920,'height':1080},device_scale_factor=1)
        page.goto((ROOT/'film.html').as_uri());page.evaluate('window.ready')
        if opt.preview:
            sheet=Image.new('RGB',(1280,4*390),'#eee')
            for j,t in enumerate([2.6,6.8,12.4,18.2,23.6,29.4,34,38.3]):
                page.evaluate('(t)=>render(t)',t);data=page.screenshot(type='png')
                im=Image.open(BytesIO(data));im.save(ROOT/'assets'/f'check-{j}.png');im=im.resize((640,360))
                x=(j%2)*640;y=(j//2)*390;sheet.paste(im,(x,y));d=ImageDraw.Draw(sheet);d.text((x+12,y+369),f'{t:.1f}s',fill='#182a22')
            sheet.save(ROOT/'Storyboard.jpg',quality=95)
            print('Preview complete');browser.close();return
        log=open(ROOT/'render.log','w')
        cmd=[ff,'-y','-f','image2pipe','-vcodec','mjpeg','-framerate',str(opt.fps),'-i','-','-i',str(ROOT/'assets/mix.wav'),'-map','0:v','-map','1:a','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-c:a','aac','-ar','48000','-b:a','192k','-af','loudnorm=I=-16:TP=-1.2:LRA=9','-t','40','-movflags','+faststart',str(ROOT/'Contexa-40s-Commercial.mp4')]
        enc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stderr=log)
        try:
            for frame in range(40*opt.fps):
                t=frame/opt.fps;page.evaluate('(t)=>render(t)',t)
                enc.stdin.write(page.screenshot(type='jpeg',quality=96))
                if frame%(opt.fps*2)==0:print(f'Rendered {t:.0f}/40s',flush=True)
        finally:enc.stdin.close()
        result=enc.wait();log.close();browser.close()
        if result:raise RuntimeError('Video encode failed; see render.log')
    print('Video complete',flush=True)
if __name__=='__main__':main()
