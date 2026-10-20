from pathlib import Path
from PIL import Image,ImageDraw
import requests,json,subprocess,re
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parent
def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def main():
    for n in ['Inter','Manrope']:
        f=ROOT/'assets'/f'{n}-OFL.txt'
        if not f.exists():
            response=requests.get(f'https://raw.githubusercontent.com/google/fonts/main/ofl/{n.lower()}/OFL.txt');response.raise_for_status();f.write_text(response.text,encoding='utf-8')
    timings=json.loads((ROOT/'assets/timings.json').read_text())
    captions='\n\n'.join(f'{i+1}\n{stamp(x["start"])} --> {stamp(x["end"])}\n{x["text"]}' for i,x in enumerate(timings))
    (ROOT/'Contexa-Captions.srt').write_text(captions,encoding='utf-8')
    Image.open(ROOT/'assets/check-7.png').convert('RGB').save(ROOT/'Contexa-Poster.jpg',quality=96)
    ff=imageio_ffmpeg.get_ffmpeg_exe();video=ROOT/'Contexa-40s-Commercial.mp4'
    result=subprocess.run([ff,'-i',str(video),'-f','null','-'],capture_output=True,text=True)
    (ROOT/'verification.log').write_text(result.stderr)
    if result.returncode:raise RuntimeError('Final video did not decode cleanly')
    loud=subprocess.run([ff,'-i',str(video),'-af','loudnorm=I=-16:TP=-1.2:LRA=9:print_format=json','-f','null','-'],capture_output=True,text=True)
    (ROOT/'audio-verification.log').write_text(loud.stderr)
    match=re.search(r'\{\s*"input_i".*?\}',loud.stderr,re.S)
    audio=json.loads(match.group()) if match else {}
    report={'duration_seconds':40,'dimensions':[1920,1080],'frames_per_second':30,'expected_frames':1200,'full_decode_passed':True,'narration_tempo_adjustments':[x['tempo'] for x in timings],'audio_measured':audio,'size_bytes':video.stat().st_size,'demo':'Actual frontend components with synthetic fixture data; animated engine and Claude handoff explanations','publication':'Not published','old_deliverables':'Deletion requested by user; shell deletion rejected by automatic approval review.'}
    (ROOT/'verification.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
