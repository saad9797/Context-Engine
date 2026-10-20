from pathlib import Path
import asyncio, json, re, subprocess, wave
import edge_tts, imageio_ffmpeg, numpy as np
ROOT=Path(__file__).resolve().parent
# Voice segments are recorded separately to leave intentional breathing room.
SEGMENTS=[
 (0.15,4.4,"Still struggling to give Claude the right context?"),
 (4.65,8.7,"Contexa's got you. Your context engine for AI."),
 (9.0,14.4,"Connect your repo. See your whole project in one interface."),
 (14.65,19.8,"Describe your change. Like adding role-based access."),
 (20.1,25.9,"Contexa prepares relevant source and contracts in a focused task pack."),
 (26.15,31.0,"Set your budget. Review the pack. Copy it into Claude."),
 (31.25,35.8,"Reuse the base. Change the task. Get back to building."),
 (36.0,40.0,"Try Contexa. Your repo. One real task.")
]
def narration_file(i):
    return ROOT/'assets'/(f'narration-{i}-project-overview.mp3' if i == 2 else f'narration-{i}.mp3')
async def generate():
    for i,(_,_,s) in enumerate(SEGMENTS):
        f=narration_file(i)
        if not f.exists():
            await asyncio.wait_for(edge_tts.Communicate(s,'en-US-AndrewMultilingualNeural',rate='+0%',pitch='+0Hz').save(str(f)),50)
        print('voice',i,flush=True)
def main():
    asyncio.run(generate())
    ff=imageio_ffmpeg.get_ffmpeg_exe();sr=48000
    voice=np.zeros(sr*40,dtype=np.float32);timings=[]
    for i,(start,end,s) in enumerate(SEGMENTS):
        path=narration_file(i)
        result=subprocess.run([ff,'-i',str(path),'-f','f32le','-ac','1','-ar',str(sr),'-'],capture_output=True,check=True)
        data=np.frombuffer(result.stdout,dtype='<f4');duration=len(data)/sr
        available=end-start-.12
        # Keep the neural performance intact unless the segment overflows.
        tempo=max(1,duration/available)
        if tempo>1.015:
            result=subprocess.run([ff,'-i',str(path),'-af',f'atempo={tempo:.5f}','-f','f32le','-ac','1','-ar',str(sr),'-'],capture_output=True,check=True)
            data=np.frombuffer(result.stdout,dtype='<f4')
        idx=int(sr*start);data=data[:len(voice)-idx];voice[idx:idx+len(data)]+=data
        timings.append({'start':start,'end':start+len(data)/sr,'text':s,'original_duration':duration,'tempo':tempo})
    # A restrained original 120-bpm score: warm synth chords, bass, soft drums.
    length=sr*40;music=np.zeros(length);rng=np.random.default_rng(42)
    def add(at,sound,gain=1):
        ix=int(at*sr);n=min(len(sound),length-ix)
        if n>0:music[ix:ix+n]+=sound[:n]*gain
    chords=[(130.813,164.814,195.998,246.942),(110,130.813,164.814,195.998),(87.307,110,130.813,164.814),(97.999,123.471,146.832,195.998)]
    for k,at in enumerate(np.arange(0,40,2)):
        u=np.arange(int(sr*2.6))/sr;env=np.minimum(u*5,1)*np.exp(-u*.9)
        chord=sum(np.sin(2*np.pi*f*u+.12*np.sin(2*np.pi*.8*u)) for f in chords[k%4])/4
        add(at,chord*env,.045)
    for k,at in enumerate(np.arange(0,40,.5)):
        u=np.arange(int(sr*.24))/sr
        kick=np.sin(2*np.pi*(48*u+4*(1-np.exp(-u*32))))*np.exp(-u*23)
        add(at,kick,.14 if at>=4.5 else .07)
        if k%2:
            u=np.arange(int(sr*.11))/sr;add(at,rng.normal(0,1,len(u))*np.exp(-u*54),.025)
        u=np.arange(int(sr*.06))/sr
        noise=rng.normal(0,1,len(u));noise=np.r_[noise[0],np.diff(noise)]
        add(at+.25,noise*np.exp(-u*85),.006)
        u=np.arange(int(sr*.32))/sr;f=chords[(k//4)%4][k%4]*4
        add(at,np.sin(2*np.pi*f*u)*np.exp(-u*16)*np.minimum(u*140,1),.022)
    # Tonal micro-impacts and airy transitions, matched to the visual edit.
    for at in [4.45,8.85,14.4,20,26,31,35.9]:
        u=np.arange(int(sr*.28))/sr
        add(at,np.sin(2*np.pi*(600*u-500*u*u))*np.exp(-u*22),.035)
    t=np.arange(length)/sr
    music*=np.minimum(t/.3,1)*np.minimum((40-t)/1.0,1)
    # Duck under narration with a smoothed speech envelope.
    active=(np.abs(voice)>.012).astype(float)
    envelope=np.convolve(active,np.ones(4800)/4800,mode='same')
    mix=voice*.94+music*(1-.60*np.minimum(envelope*4,1))
    mix=np.tanh(mix*1.1)
    def write(name,data):
        with wave.open(str(ROOT/name),'wb') as w:
            w.setparams((1,2,sr,0,'NONE','not compressed'));w.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
    write('assets/narration.wav',voice);write('assets/music.wav',music);write('assets/mix.wav',mix)
    (ROOT/'assets/timings.json').write_text(json.dumps(timings,indent=2))
    print(json.dumps(timings,indent=2),flush=True)
if __name__=='__main__':main()
