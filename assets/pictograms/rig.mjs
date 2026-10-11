/** Dependency-free articulated PNG renderer. Angles are local radians. */
export function transformPoint(m, [x, y]) {
  return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]];
}

export function poseRig(rig, character, options = {}) {
  const definition = rig.characters[character];
  if (!definition) throw new Error(`Unknown character: ${character}`);
  const {angles = {}, variants = {}, origin = [0,0], scale = 1} = options;
  if (!Number.isFinite(scale) || scale <= 0 || origin.length !== 2 || !origin.every(Number.isFinite)) {
    throw new Error('Origin must contain two finite numbers; scale must be positive.');
  }
  const result = new Map();
  for (const bone of definition.bones) {
    const variantName = variants[bone.id] ?? Object.keys(bone.variants)[0];
    const sprite = bone.variants[variantName];
    if (!sprite) throw new Error(`Unknown variant ${variantName} for ${bone.id}`);
    const angle = angles[bone.id] ?? 0;
    if (!Number.isFinite(angle)) throw new Error(`Invalid angle for ${bone.id}`);
    const parent = bone.parent ? result.get(bone.parent) : null;
    if (bone.parent && !parent) throw new Error(`Parent ${bone.parent} must precede ${bone.id}`);
    const joint = parent ? transformPoint(parent.matrix, bone.attachment) : origin;
    const rotation = (parent?.rotation ?? 0) + angle;
    const a = scale*Math.cos(rotation), b = scale*Math.sin(rotation);
    const c = -b, d = a, [px,py] = sprite.pivot;
    const matrix = [a,b,c,d,joint[0]-a*px-c*py,joint[1]-b*px-d*py];
    result.set(bone.id, {id:bone.id, parent:bone.parent, sprite, variantName, joint, rotation, matrix});
  }
  return result;
}

export async function loadRigImages(rig, assetBase, createImage = () => new Image()) {
  const files = new Set(Object.values(rig.characters).flatMap(c => c.bones.flatMap(b => Object.values(b.variants).map(s => s.file))));
  const entries = await Promise.all([...files].map(async file => {
    const image = createImage();
    const ready = new Promise((resolve,reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error(`Could not load ${file}`));
    });
    image.src = new URL(file, assetBase).href;
    await ready;
    if (image.naturalWidth !== rig.canvasSize[0] || image.naturalHeight !== rig.canvasSize[1]) {
      throw new Error(`Unexpected image size for ${file}`);
    }
    return [file,image];
  }));
  return new Map(entries);
}

export function drawRig(ctx, rig, images, character, options = {}) {
  const posed = poseRig(rig,character,options);
  for (const bone of posed.values()) {
    const image = images.get(bone.sprite.file);
    if (!image) throw new Error(`Image missing: ${bone.sprite.file}`);
    ctx.save();
    ctx.transform(...bone.matrix);
    const [x0,y0,x1,y1] = bone.sprite.region;
    ctx.beginPath(); ctx.rect(x0,y0,x1-x0,y1-y0); ctx.clip();
    ctx.drawImage(image,0,0);
    ctx.restore();
  }
  if (options.showJoints) {
    ctx.save();
    ctx.fillStyle = options.jointColor ?? '#b24026';
    for (const bone of posed.values()) {
      ctx.beginPath(); ctx.arc(...bone.joint,options.jointRadius ?? 4,0,Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }
  return posed;
}
