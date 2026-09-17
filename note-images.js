/* Account-scoped, content-addressed screenshot assets. Never delete assets when
   removing a note: earlier recovery snapshots may still reference them. */
(() => {
  const MAX_DATA_LENGTH = 800000;
  const cache = new Map();
  const validId = id => typeof id === "string" && /^[a-f0-9]{64}$/.test(id);
  const validate = data => {
    if (typeof data !== "string" || data.length > MAX_DATA_LENGTH || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)) throw new Error("Invalid screenshot data.");
    return data;
  };
  const user = () => {
    const current = firebase.auth().currentUser;
    if (!current || current.isAnonymous) throw new Error("Sign in to add or load screenshots.");
    return current.uid;
  };
  const checkUser = uid => { if (user() !== uid) throw new Error("Your account changed. Please try again."); };
  const hash = async data => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data))), b => b.toString(16).padStart(2, "0")).join("");
  const bounded = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Screenshot sync timed out. Check your connection and try again.")), 20000); })]); }
    finally { clearTimeout(timer); }
  };
  function assetRef(uid, id) { return firebase.firestore().collection("users").doc(uid).collection("noteImages").doc(id); }
  async function put(data, expectedId, expectedOwner) {
    const uid = user(); if (expectedOwner && expectedOwner !== uid) throw new Error("Your account changed. Please try again."); validate(data);
    const id = await hash(data);
    if (expectedId && expectedId !== id) throw new Error("Screenshot integrity check failed.");
    checkUser(uid);
    const key = uid + ":" + id;
    if (!cache.has(key)) {
      await bounded(assetRef(uid, id).set({ data, sha256: id, kind: "note-image-v1" }));
      checkUser(uid); cache.set(key, data);
    }
    return id;
  }
  async function load(id) {
    const uid = user(); if (!validId(id)) throw new Error("Invalid screenshot reference.");
    const key = uid + ":" + id;
    if (cache.has(key)) return cache.get(key);
    const doc = await bounded(assetRef(uid, id).get()); checkUser(uid);
    if (!doc.exists) throw new Error("This screenshot is missing. Try restoring an image-inclusive backup.");
    const data = validate(doc.data().data);
    if (await hash(data) !== id) throw new Error("Screenshot integrity check failed.");
    checkUser(uid); cache.set(key, data); return data;
  }
  const idsFor = main => [...new Set([
    ...Object.values(main.noteImages || {}).flat(), ...(main.notes || []).flatMap(note => note.images || [])
  ].map(image => image.assetId))];
  async function exportAssets(main) {
    const uid = user(), assets = {};
    for (const id of idsFor(main)) { assets[id] = await load(id); checkUser(uid); }
    return assets;
  }
  async function validateAssets(assets, main) {
    if (!assets || typeof assets !== "object" || Array.isArray(assets)) throw new Error("This backup is missing its screenshot files.");
    for (const id of idsFor(main)) {
      if (!validId(id) || !Object.prototype.hasOwnProperty.call(assets, id) || await hash(validate(assets[id])) !== id) throw new Error("A screenshot in this backup is missing or damaged.");
    }
  }
  async function importAssets(assets, main) {
    await validateAssets(assets, main);
    const uid = user();
    for (const id of idsFor(main)) { checkUser(uid); await put(assets[id], id); }
  }
  async function prepare(file) {
    if (!file || !/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) throw new Error("Choose a PNG, JPG, WebP, or GIF screenshot.");
    if (file.size > 20 * 1024 * 1024) throw new Error("This image is larger than 20 MB. Choose a smaller screenshot.");
    const url = URL.createObjectURL(file);
    const image = new Image();
    try {
      await bounded(new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("This image could not be opened.")); image.src = url; }));
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 50000000) throw new Error("This image is too large to process. Choose a smaller screenshot.");
      let scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      for (let attempt = 0; attempt < 5; attempt++) {
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.92, 0.8, 0.65]) {
          const data = canvas.toDataURL("image/webp", quality);
          if (data.length <= MAX_DATA_LENGTH) return { data: validate(data), width: canvas.width, height: canvas.height };
        }
        scale *= 0.75;
      }
      throw new Error("This image could not fit safely. Try a smaller screenshot.");
    } finally { URL.revokeObjectURL(url); }
  }
  firebase.auth().onAuthStateChanged(() => cache.clear());
  window.noteImageStore = { put, load, prepare, idsFor, exportAssets, validateAssets, importAssets, owner: user };
})();
