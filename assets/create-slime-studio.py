"""Rebuild the appearance study with Blender 4.5 LTS, in background mode.
blender --background --python assets/create-slime-studio.py
Coordinates in the design functions are Y-up. Blender vertices are converted
to Z-up on authoring; the glTF exporter converts them back to Y-up.
"""
import bpy, bmesh, math, random, json, hashlib
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parent.parent
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.context.preferences.filepaths.save_version = 0
# Shape-only recipe. Material, camera, topology and attachment rules are shared
# with the accepted appearance baseline. Keep art decisions out of the shader.
REST_SHAPE = json.loads((ROOT/'assets/slime-rest-shape.json').read_text(encoding='utf-8'))
PROFILE = REST_SHAPE['width']
DEPTH_PROFILE = REST_SHAPE['depth']
H = REST_SHAPE['height']
VERTICAL_SCALE = REST_SHAPE.get('vertical_scale', 1.0)
CALIBRATION = REST_SHAPE['projection_calibration']
PUFF_PROFILE = [(0,.72),(.06,.87),(.18,1.03),(.38,1.22),(.70,1.41),
                (1.08,1.48),(1.40,1.44),(1.72,1.26),(1.98,.94),
                (2.16,.54),(2.23,.245),(2.25,0)]

CURVES={}

def bezier(values,t):
    n=len(values)-1
    return sum(math.comb(n,i)*(1-t)**(n-i)*t**i*values[i] for i in range(n+1))

def measured_radius(profile,y):
    h=y/H
    if h>=1: return 0
    if h<=0: return H*profile['lower_radius_controls'][0]
    if h<profile['belly_height']:
        lo,hi=0.0,1.0
        for _ in range(35):
            t=(lo+hi)/2
            if bezier(profile['lower_height_controls'],t)<h: lo=t
            else: hi=t
        return H*bezier(profile['lower_radius_controls'],(lo+hi)/2)
    # C2 cubic B-spline of squared radius. These control values come from the
    # approved front/side silhouettes, including the crown-to-shoulder inflection.
    knots=profile['upper_knots']
    b=[float(knots[i]<=h<knots[i+1]) for i in range(len(knots)-1)]
    for degree in range(1,4):
        b=[((h-knots[i])/(knots[i+degree]-knots[i])*b[i] if knots[i+degree]>knots[i] else 0)+
           ((knots[i+degree+1]-h)/(knots[i+degree+1]-knots[i+1])*b[i+1] if knots[i+degree+1]>knots[i+1] else 0)
           for i in range(len(b)-1)]
    return H*math.sqrt(max(0,sum(w*q for w,q in zip(b,profile['upper_radius_squared_controls']))))
def squared_curve(profile):
    # Shape-preserving cubic slopes avoid bumps between authored control rings.
    # Interpolating radius squared also gives the cap a horizontal tangent.
    if id(profile) in CURVES: return CURVES[id(profile)]
    x=[p[0] for p in profile]; q=[p[1]**2 for p in profile]
    h=[x[i+1]-x[i] for i in range(len(x)-1)]
    d=[(q[i+1]-q[i])/h[i] for i in range(len(h))]
    m=[0.0]*len(x)
    for i in range(1,len(x)-1):
        if d[i-1]*d[i]>0:
            w1=2*h[i]+h[i-1]; w2=h[i]+2*h[i-1]
            m[i]=(w1+w2)/(w1/d[i-1]+w2/d[i])
    def end(h0,h1,d0,d1):
        v=((2*h0+h1)*d0-h0*d1)/(h0+h1)
        if v*d0<=0: return 0
        return min(abs(v),3*abs(d0))*math.copysign(1,d0)
    m[0]=end(h[0],h[1],d[0],d[1]); m[-1]=end(h[-1],h[-2],d[-1],d[-2])
    CURVES[id(profile)]=(q,m)
    return q,m

def radius(y, profile=PROFILE):
    y = max(0,min(H,y))
    if profile is PROFILE or profile is DEPTH_PROFILE:
        return measured_radius(profile,y)*CALIBRATION['radial_scale']
    i = next((j for j in range(len(profile)-1) if y <= profile[j+1][0]),len(profile)-2)
    y0=profile[i][0]; y1=profile[i+1][0]; t=(y-y0)/(y1-y0)
    q,m=squared_curve(profile)
    return math.sqrt(max(0,(2*t**3-3*t*t+1)*q[i]+(t**3-2*t*t+t)*m[i]*(y1-y0)+(-2*t**3+3*t*t)*q[i+1]+(t**3-t*t)*m[i+1]*(y1-y0)))
def center(y): return 0.0
def rim(y,a):
    r=radius(y)
    # The reference pose comes from the camera. Rest stays plump in every view.
    return (r*math.cos(a),y,center(y)+radius(y,DEPTH_PROFILE)*math.sin(a))
def skin(x,y):
    lo,hi=0,math.pi
    for _ in range(35):
        a=(lo+hi)/2
        if rim(y,a)[0]>x: lo=a
        else: hi=a
    return rim(y,(lo+hi)/2)[2]
def deform(p,pose):
    x,y,z=p
    if pose=='Breathe': return (x*.995,y*1.018,z*.988)
    if pose=='Squash': return (x*1.14,y*.77,z*1.14)
    # Continuous rounded profile: no discontinuity above the contact patch.
    rr=radius(y,PUFF_PROFILE)
    r=radius(y)
    depth=radius(y,DEPTH_PROFILE)
    sx=rr/r if r>.001 else 1
    sz=rr*.90/depth if depth>.001 else 1
    return (x*sx,y*1.12,(z-center(y))*sz+center(y)*.35)
def coords(p): return (p[0],-p[2],p[1]*VERTICAL_SCALE)
def material(name,hexcolor,rough=.1):
    m=bpy.data.materials.new(name); m.use_nodes=True
    def linear(v): return v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4
    c=tuple(linear(int(hexcolor[i:i+2],16)/255) for i in (0,2,4))
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*c,1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=rough
    return m
gel=material('Rose gel','fff3ef',.075)
bsdf=gel.node_tree.nodes['Principled BSDF']
bsdf.inputs['Transmission Weight'].default_value=.96
bsdf.inputs['IOR'].default_value=1.36
black=material('Soft black eyes','040405',.10)
black.node_tree.nodes['Principled BSDF'].inputs['Coat Weight'].default_value=.35
black.node_tree.nodes['Principled BSDF'].inputs['Coat Roughness'].default_value=.06
ink=material('Smile ink','0b0508',.65)
objects=[]
def mesh(name,verts,faces,mat):
    data=bpy.data.meshes.new(name); data.from_pydata([coords(p) for p in verts],[],faces); data.update()
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    obj=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    for p in data.polygons:p.use_smooth=True
    obj.shape_key_add(name='Basis')
    for pose in ['Breathe','Squash','Puff']:
        key=obj.shape_key_add(name=pose)
        for i,p in enumerate(verts):key.data[i].co=coords(deform(p,pose))
    objects.append(obj)
    return obj

segments,rings=160,120
# More samples where the surface turns into the crown and floor, at the same
# vertex budget. Uniform height rings undersample both near-horizontal ends.
verts=[rim(H*(.5-.5*math.cos(math.pi*j/rings)),2*math.pi*k/segments) for j in range(rings) for k in range(segments)]
faces=[]
for j in range(rings-1):
    for k in range(segments):
        n=(k+1)%segments
        faces.append((j*segments+k,j*segments+n,(j+1)*segments+n,(j+1)*segments+k))
bottom=len(verts); verts.append((0,0,0)); top=len(verts); verts.append((0,H,center(H)))
for k in range(segments):
    n=(k+1)%segments
    faces.append((bottom,n,k)); faces.append((top,(rings-1)*segments+k,(rings-1)*segments+n))
body=mesh('Gel',verts,faces,gel)
for sign,label in [(-1,'L'),(1,'R')]:
    v=[]; f=[]; lat,lon=18,32
    for j in range(lat+1):
        t=math.pi*j/lat
        for k in range(lon):
            a=2*math.pi*k/lon
            x=sign*H*.4674887892/2*CALIBRATION['eye_spacing_scale']+H*.1199551569/2*math.sin(t)*math.cos(a)
            y=H*(.235426009+CALIBRATION['face_height_offset'])+H*.1233183857/2*math.cos(t)
            z=skin(x,y)+.004+.080*math.sin(t)*math.sin(a)
            v.append((x,y,z))
    for j in range(lat):
        for k in range(lon):
            n=(k+1)%lon; f.append((j*lon+k,j*lon+n,(j+1)*lon+n,(j+1)*lon+k))
    mesh('Eye.'+label,v,f,black)
v=[]; f=[]; steps,tube=40,10
for j in range(steps+1):
    t=2*j/steps-1; x=H*(.10313901-.012)*t/2; y=H*(.17297758+CALIBRATION['face_height_offset']+.024*t*t)
    tangent=Vector((H*(.10313901-.012)/2,H*.048*t,0)).normalized(); normal=Vector((-tangent.y,tangent.x,0))
    for k in range(tube):
        a=2*math.pi*k/tube
        xx=x+normal.x*math.cos(a)*.012; yy=y+normal.y*math.cos(a)*.012
        v.append((xx,yy,skin(xx,yy)+.02+math.sin(a)*.012))
for j in range(steps):
    for k in range(tube):
        n=(k+1)%tube; f.append((j*tube+k,j*tube+n,(j+1)*tube+n,(j+1)*tube+k))
f.append(tuple(range(tube-1,-1,-1)));f.append(tuple(steps*tube+k for k in range(tube)))
mesh('Smile',v,f,ink)

rng=random.Random(24); bubbles=[]
for i in range(142):
    y=rng.uniform(.18,H-.16); a=rng.uniform(0,2*math.pi); radial=math.sqrt(rng.uniform(.06,.82))
    edge=rim(y,a); p=(edge[0]*radial,y,center(y)+(edge[2]-center(y))*radial)
    r=.008+rng.random()**2*(.023 if i<120 else .047)
    bubbles.append({'p':p,'r':r,'poses':[deform(p,s) for s in ['Breathe','Squash','Puff']]})
for u,y,v,r in [(-.465,.96,.56,.104),(-.42,.63,.64,.058),(.162,1.62,.468,.053),(.462,1.16,.61,.045)]:
    p=(u*radius(y),y,center(y)+v*radius(y,DEPTH_PROFILE))
    bubbles.append({'p':p,'r':r,'poses':[deform(p,s) for s in ['Breathe','Squash','Puff']]})
for i in range(12):
    u,y,v=rng.uniform(-.61,.61),rng.uniform(.12,.29),rng.uniform(.57,.77)
    p=(u*radius(y),y,center(y)+v*radius(y,DEPTH_PROFILE))
    bubbles.append({'p':p,'r':rng.uniform(.010,.023),'poses':[deform(p,s) for s in ['Breathe','Squash','Puff']]})
for bubble in bubbles:
    bubble['p']=(bubble['p'][0],bubble['p'][1]*VERTICAL_SCALE,bubble['p'][2])
    bubble['poses']=[(p[0],p[1]*VERTICAL_SCALE,p[2]) for p in bubble['poses']]
body['bubble_data']=json.dumps(bubbles,separators=(',',':'))
body['optical_profile']=json.dumps([[radius(H*i/511),radius(H*i/511,PUFF_PROFILE),center(H*i/511),H*i/511*VERTICAL_SCALE,radius(H*i/511,DEPTH_PROFILE),radius(H*i/511,PUFF_PROFILE)*.90] for i in range(512)],separators=(',',':'))
body['design_note']='Centered resting volume / round side / embedded low face / shared facial deformation'
body['shape_revision']=REST_SHAPE['revision']
body['shape_recipe_sha256']=hashlib.sha256((ROOT/'assets/slime-rest-shape.json').read_text(encoding='utf-8').encode('utf-8')).hexdigest()

bpy.context.scene.world.color=(.7,.7,.7)
for obj in objects: obj.select_set(True)
bpy.context.view_layer.objects.active=body
(ROOT/'public/models').mkdir(parents=True,exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/slime-studio.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'public/models/slime-studio.glb'),export_format='GLB',use_selection=True,export_extras=True,export_cameras=False,export_lights=False,export_animations=False,export_morph=True,export_morph_normal=True)
print('STUDIO_ASSET_READY',len(body.data.vertices),'body vertices',len(bubbles),'bubbles')
