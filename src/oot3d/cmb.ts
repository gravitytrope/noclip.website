
import { assert, readString } from '../util';
import ArrayBufferSlice from '../ArrayBufferSlice';
import { RenderFlags, CullMode, BlendFactor, BlendMode } from '../render';
import { mat4 } from 'gl-matrix';

interface VertexBufferSlices {
    posBuffer: ArrayBufferSlice;
    nrmBuffer: ArrayBufferSlice;
    colBuffer: ArrayBufferSlice;
    txcBuffer: ArrayBufferSlice;
}

const enum Version {
    Ocarina, Majora
}

export class CMB {
    public name: string;
    public version: Version;
    public textures: Texture[] = [];
    public vertexBufferSlices: VertexBufferSlices;

    public materials: Material[] = [];
    public bones: Bone[] = [];
    public sepds: Sepd[] = [];
    public meshs: Mesh[] = [];
    public indexBuffer: ArrayBufferSlice;
}

interface Bone {
    boneId: number;
    parentBoneId: number;
    modelMatrix: mat4;
}

function calcModelMtx(dst: mat4, scaleX: number, scaleY: number, scaleZ: number, rotationX: number, rotationY: number, rotationZ: number, translationX: number, translationY: number, translationZ: number): void {
    const sinX = Math.sin(rotationX), cosX = Math.cos(rotationX);
    const sinY = Math.sin(rotationY), cosY = Math.cos(rotationY);
    const sinZ = Math.sin(rotationZ), cosZ = Math.cos(rotationZ);

    dst[0] =  scaleX * (cosY * cosZ);
    dst[1] =  scaleX * (sinZ * cosY);
    dst[2] =  scaleX * (-sinY);
    dst[3] =  0.0;

    dst[4] =  scaleY * (sinX * cosZ * sinY - cosX * sinZ);
    dst[5] =  scaleY * (sinX * sinZ * sinY + cosX * cosZ);
    dst[6] =  scaleY * (sinX * cosY);
    dst[7] =  0.0;

    dst[8] =  scaleZ * (cosX * cosZ * sinY + sinX * sinZ);
    dst[9] =  scaleZ * (cosX * sinZ * sinY - sinX * cosZ);
    dst[10] = scaleZ * (cosY * cosX);
    dst[11] = 0.0;

    dst[12] = translationX;
    dst[13] = translationY;
    dst[14] = translationZ;
    dst[15] = 1.0;
}

function readSklChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'skl ');

    const boneTableCount = view.getUint32(0x08, true);

    const bones: Bone[] = [];
    let boneTableIdx = 0x10;
    for (let i = 0; i < boneTableCount; i++) {
        const boneId = view.getInt16(boneTableIdx + 0x00, true) & 0x0FFF;
        const parentBoneId = view.getInt16(boneTableIdx + 0x02, true);

        const scaleX = view.getFloat32(boneTableIdx + 0x04, true);
        const scaleY = view.getFloat32(boneTableIdx + 0x08, true);
        const scaleZ = view.getFloat32(boneTableIdx + 0x0C, true);
        const rotationX = view.getFloat32(boneTableIdx + 0x10, true);
        const rotationY = view.getFloat32(boneTableIdx + 0x14, true);
        const rotationZ = view.getFloat32(boneTableIdx + 0x18, true);
        const translationX = view.getFloat32(boneTableIdx + 0x1C, true);
        const translationY = view.getFloat32(boneTableIdx + 0x20, true);
        const translationZ = view.getFloat32(boneTableIdx + 0x24, true);

        const modelMatrix = mat4.create();
        calcModelMtx(modelMatrix, scaleX, scaleY, scaleZ, rotationX, rotationY, rotationZ, translationX, translationY, translationZ);

        const bone: Bone = { boneId, parentBoneId, modelMatrix };
        bones.push(bone);

        boneTableIdx += 0x28;
        if (cmb.version === Version.Majora)
            boneTableIdx += 0x04;
    }
    cmb.bones = bones;
}

export enum TextureFilter {
    NEAREST = 0x2600,
    LINEAR = 0x2601,
    NEAREST_MIPMAP_NEAREST = 0x2700,
    LINEAR_MIPMAP_NEAREST = 0x2701,
    NEAREST_MIPMIP_LINEAR = 0x2702,
    LINEAR_MIPMAP_LINEAR = 0x2703,
}

export enum TextureWrapMode {
    CLAMP = 0x2900,
    REPEAT = 0x2901,
    CLAMP_TO_EDGE = 0x812F,
    MIRRORED_REPEAT = 0x8370,
}

interface TextureBinding {
    textureIdx: number;
    minFilter: TextureFilter;
    magFilter: TextureFilter;
    wrapS: TextureWrapMode;
    wrapT: TextureWrapMode;
}

export interface Material {
    index: number;
    textureBindings: TextureBinding[];
    alphaTestEnable: boolean;
    renderFlags: RenderFlags;
}

function readMatsChunk(cmb: CMB, buffer: ArrayBufferSlice) {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mats');
    const count = view.getUint32(0x08, true);

    let offs = 0x0C;
    for (let i = 0; i < count; i++) {
        let bindingOffs = offs + 0x10;
        const textureBindings: TextureBinding[] = [];

        for (let j = 0; j < 3; j++) {
            const textureIdx = view.getInt16(bindingOffs + 0x00, true);
            const minFilter = view.getUint16(bindingOffs + 0x04, true);
            const magFilter = view.getUint16(bindingOffs + 0x06, true);
            const wrapS = view.getUint16(bindingOffs + 0x08, true);
            const wrapT = view.getUint16(bindingOffs + 0x0A, true);
            textureBindings.push({ textureIdx, minFilter, magFilter, wrapS, wrapT });
            bindingOffs += 0x18;
        }

        const alphaTestEnable = !!view.getUint8(offs + 0x130);

        const renderFlags = new RenderFlags();
        const blendEnable = !!view.getUint8(offs + 0x138);
        renderFlags.blendSrc = view.getUint16(offs + 0x13C, true) as BlendFactor;
        renderFlags.blendDst = view.getUint16(offs + 0x13E, true) as BlendFactor;
        renderFlags.blendMode = blendEnable ? view.getUint16(offs + 0x140, true) as BlendMode : BlendMode.NONE;
        renderFlags.depthTest = true;
        renderFlags.depthWrite = !blendEnable;
        renderFlags.cullMode = CullMode.BACK;

        cmb.materials.push({ index: i, textureBindings, alphaTestEnable, renderFlags });
        offs += 0x15C;

        if (cmb.version === Version.Majora)
            offs += 0x10;
    }
}

enum TextureFormat {
    ETC1     = 0x0000675A,
    ETC1A4   = 0x0000675B,
    RGBA5551 = 0x80346752,
    RGB565   = 0x83636754,
    A8       = 0x14016756,
    L8       = 0x14016757,
    L4       = 0x67616757,
    LA8      = 0x14016758,
}

export interface Texture {
    size: number;
    width: number;
    height: number;
    format: TextureFormat;
    pixels: Uint8Array;
    name: string;
}

function expand4to8(n: number) {
    return (n << 4) | n;
}

function expand5to8(n: number) {
    return (n << (8 - 5)) | (n >>> (10 - 8));
}

function expand6to8(n: number) {
    return (n << (8 - 6)) | (n >>> (12 - 8));
}

function decodeTexture_ETC1_4x4_Color(dst: Uint8Array, w1: number, w2: number, dstOffs: number, stride: number): void {
    // w1 = Upper 32-bit word, "control" data
    // w2 = Lower 32-bit word, "pixel" data

    // Table 3.17.2 -- Intensity tables for each codeword.
    const intensityTableMap = [
        [   -8,  -2,  2,   8 ],
        [  -17,  -5,  5,  17 ],
        [  -29,  -9,  9,  29 ],
        [  -42, -13, 13,  42 ],
        [  -60, -18, 18,  60 ],
        [  -80, -24, 24,  80 ],
        [ -106, -33, 33, 106 ],
        [ -183, -47, 48, 183 ],
    ];

    // Table 3.17.3 -- MSB/LSB colors to modifiers.
    //
    //  msb lsb
    //  --- ---
    //   0  0   small positive value (2nd intensity)
    //   0  1   large positive value (3rd intensity)
    //   1  0   small negative value (1st intensity)
    //   1  1   large negative value (0th intensity)
    //
    // Why the spec doesn't lay out the intensity map in this order,
    // I'll never know...
    const pixelToColorIndex = [ 2, 3, 1, 0 ];

    const diff = (w1 & 0x02) !== 0;
    const flip = (w1 & 0x01) !== 0;

    // Intensity tables for each block.
    const intensityIndex1 = (w1 >> 5) & 0x7;
    const intensityIndex2 = (w1 >> 2) & 0x7;
    const intensityTable1 = intensityTableMap[intensityIndex1];
    const intensityTable2 = intensityTableMap[intensityIndex2];

    function signed3(n: number) {
        // Sign-extend.
        return n << 29 >> 29;
    }

    function clamp(n: number) {
        if (n < 0) return 0;
        if (n > 255) return 255;
        return n;
    }

    // Get the color table for a given block.
    function getColors(colors: Uint8Array, r: number, g: number, b: number, intensityMap: number[]): void {
        for (let i = 0; i < 4; i++) {
            colors[(i * 3) + 0] = clamp(r + intensityMap[i]);
            colors[(i * 3) + 1] = clamp(g + intensityMap[i]);
            colors[(i * 3) + 2] = clamp(b + intensityMap[i]);
        }
    }

    const colors1 = new Uint8Array(3 * 4);
    const colors2 = new Uint8Array(3 * 4);

    if (diff) {
        const baseR1a = (w1 >>> 27) & 0x1F;
        const baseR2d = signed3((w1 >>> 24) & 0x07);
        const baseG1a = (w1 >>> 19) & 0x1F;
        const baseG2d = signed3((w1 >>> 16) & 0x07);
        const baseB1a = (w1 >>> 11) & 0x1F;
        const baseB2d = signed3((w1 >>>  8) & 0x07);

        const baseR1 = expand5to8(baseR1a);
        const baseR2 = expand5to8(baseR1a + baseR2d);
        const baseG1 = expand5to8(baseG1a);
        const baseG2 = expand5to8(baseG1a + baseG2d);
        const baseB1 = expand5to8(baseB1a);
        const baseB2 = expand5to8(baseB1a + baseB2d);

        getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
        getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
    } else {
        const baseR1 = expand4to8((w1 >>> 28) & 0x0F);
        const baseR2 = expand4to8((w1 >>> 24) & 0x0F);
        const baseG1 = expand4to8((w1 >>> 20) & 0x0F);
        const baseG2 = expand4to8((w1 >>> 16) & 0x0F);
        const baseB1 = expand4to8((w1 >>> 12) & 0x0F);
        const baseB2 = expand4to8((w1 >>>  8) & 0x0F);

        getColors(colors1, baseR1, baseG1, baseB1, intensityTable1);
        getColors(colors2, baseR2, baseG2, baseB2, intensityTable2);
    }

    // Go through each pixel and copy the color into the right spot...
    for (let i = 0; i < 16; i++) {
        const lsb = (w2 >>> i) & 0x01;
        const msb = (w2 >>> (16 + i)) & 0x01;
        const lookup = (msb << 1) | lsb;
        const colorsIndex = pixelToColorIndex[lookup];

        // Indexes march down and to the right here.
        const y = i & 0x03;
        const x = i >> 2;
        const dstIndex = dstOffs + ((y * stride) + x) * 4;

        // Whether we're in block 1 or block 2;
        let whichBlock;

        // If flipbit=0, the block is divided into two 2x4
        // subblocks side-by-side.
        if (!flip)
            whichBlock = x & 2;
        else
            whichBlock = y & 2;

        const colors = whichBlock ? colors2 : colors1;
        dst[dstIndex + 0] = colors[(colorsIndex * 3) + 0];
        dst[dstIndex + 1] = colors[(colorsIndex * 3) + 1];
        dst[dstIndex + 2] = colors[(colorsIndex * 3) + 2];
    }
}

function decodeTexture_ETC1_4x4_Alpha(dst: Uint8Array, a1: number, a2: number, dstOffs: number, stride: number) {
    for (let ax = 0; ax < 2; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const dstIndex = dstOffs + ((ay * stride) + ax) * 4;
            dst[dstIndex + 3] = expand4to8(a2 & 0x0F);
            a2 >>= 4;
        }
    }

    for (let ax = 2; ax < 4; ax++) {
        for (let ay = 0; ay < 4; ay++) {
            const dstIndex = dstOffs + ((ay * stride) + ax) * 4;
            dst[dstIndex + 3] = expand4to8(a1 & 0x0F);
            a1 >>= 4;
        }
    }
}

function decodeTexture_ETC1(width: number, height: number, texData: ArrayBufferSlice, alpha: boolean) {
    const pixels = new Uint8Array(width * height * 4);
    const stride = width;

    const src = texData.createDataView();
    let offs = 0;
    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            // Order of each set of 4 blocks: top left, top right, bottom left, bottom right...
            for (let y = 0; y < 8; y += 4) {
                for (let x = 0; x < 8; x += 4) {
                    const dstOffs = ((yy + y) * stride + (xx + x)) * 4;

                    let a1;
                    let a2;
                    if (alpha) {
                        // In ETC1A4 mode, we have 8 bytes of per-pixel alpha data preceeding the tile.
                        a2 = src.getUint32(offs + 0x00, true);
                        a1 = src.getUint32(offs + 0x04, true);
                        offs += 0x08;
                    } else {
                        a2 = 0xFFFFFFFF;
                        a1 = 0xFFFFFFFF;
                    }
                    decodeTexture_ETC1_4x4_Alpha(pixels, a1, a2, dstOffs, stride);

                    const w2 = src.getUint32(offs + 0x00, true);
                    const w1 = src.getUint32(offs + 0x04, true);
                    decodeTexture_ETC1_4x4_Color(pixels, w1, w2, dstOffs, stride);
                    offs += 0x08;
                }
            }
        }
    }

    return pixels;
}

type PixelDecode = (pixels: Uint8Array, dstOffs: number) => void;

function decodeTexture_Tiled(width: number, height: number, decoder: PixelDecode) {
    const pixels = new Uint8Array(width * height * 4);
    const stride = width;

    function morton7(n: number) {
        // 0a0b0c => 000abc
        return ((n >> 2) & 0x04) | ((n >> 1) & 0x02) | (n & 0x01);
    }

    for (let yy = 0; yy < height; yy += 8) {
        for (let xx = 0; xx < width; xx += 8) {
            // Iterate in Morton order inside each tile.
            for (let i = 0; i < 0x40; i++) {
                const x = morton7(i);
                const y = morton7(i >> 1);
                const dstOffs = ((yy + y) * stride + xx + x) * 4;
                decoder(pixels, dstOffs);
            }
        }
    }

    return pixels;
}

function decodeTexture_RGBA5551(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint16(srcOffs, true);
        pixels[dstOffs + 0] = expand5to8((p >> 11) & 0x1F);
        pixels[dstOffs + 1] = expand5to8((p >> 6) & 0x1F);
        pixels[dstOffs + 2] = expand5to8((p >> 1) & 0x1F);
        pixels[dstOffs + 3] = (p & 0x01) ? 0xFF : 0x00;
        srcOffs += 2;
    });
}

function decodeTexture_RGB565(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint16(srcOffs, true);
        pixels[dstOffs + 0] = expand5to8((p >> 11) & 0x1F);
        pixels[dstOffs + 1] = expand6to8((p >> 5) & 0x3F);
        pixels[dstOffs + 2] = expand5to8(p & 0x1F);
        pixels[dstOffs + 3] = 0xFF;
        srcOffs += 2;
    });
}

function decodeTexture_A8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const A = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = 0xFF;
        pixels[dstOffs + 1] = 0xFF;
        pixels[dstOffs + 2] = 0xFF;
        pixels[dstOffs + 3] = A;
    });
}

function decodeTexture_L4(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const p = src.getUint8(srcOffs >>> 1);
        const n = (srcOffs & 1) ? (p >>> 4) : (p & 0x0F);
        const L = expand4to8(n);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = L;
        srcOffs++;
    });
}

function decodeTexture_L8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const L = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = L;
    });
}

function decodeTexture_LA8(width: number, height: number, texData: ArrayBufferSlice) {
    const src = texData.createDataView();
    let srcOffs = 0;
    return decodeTexture_Tiled(width, height, (pixels, dstOffs) => {
        const L = src.getUint8(srcOffs++);
        const A = src.getUint8(srcOffs++);
        pixels[dstOffs + 0] = L;
        pixels[dstOffs + 1] = L;
        pixels[dstOffs + 2] = L;
        pixels[dstOffs + 3] = A;
    });
}

function decodeTexture(width: number, height: number, format: TextureFormat, texData: ArrayBufferSlice): Uint8Array {
    switch (format) {
    case TextureFormat.ETC1:
        return decodeTexture_ETC1(width, height, texData, false);
    case TextureFormat.ETC1A4:
        return decodeTexture_ETC1(width, height, texData, true);
    case TextureFormat.RGBA5551:
        return decodeTexture_RGBA5551(width, height, texData);
    case TextureFormat.RGB565:
        return decodeTexture_RGB565(width, height, texData);
    case TextureFormat.A8:
        return decodeTexture_A8(width, height, texData);
    case TextureFormat.L4:
        return decodeTexture_L4(width, height, texData);
    case TextureFormat.L8:
        return decodeTexture_L8(width, height, texData);
    case TextureFormat.LA8:
        return decodeTexture_LA8(width, height, texData);
    default:
        throw new Error(`Unsupported texture type! ${(format as number).toString(16)}`);
    }
}

export function getTextureFormatName(format: TextureFormat): string {
    switch (format) {
    case TextureFormat.ETC1: return 'ETC1';
    case TextureFormat.ETC1A4: return 'ETC1A4';
    case TextureFormat.RGBA5551: return 'RGBA5551';
    case TextureFormat.RGB565: return 'RGB565';
    case TextureFormat.A8: return 'A8';
    case TextureFormat.L4: return 'L4';
    case TextureFormat.L8: return 'L8';
    case TextureFormat.LA8: return 'LA8';
    }
}

function readTexChunk(cmb: CMB, buffer: ArrayBufferSlice, texData: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'tex ');
    const count = view.getUint32(0x08, true);
    let offs = 0x0C;
    for (let i = 0; i < count; i++) {
        const size = view.getUint32(offs + 0x00, true);
        const width = view.getUint16(offs + 0x08, true);
        const height = view.getUint16(offs + 0x0A, true);
        const format = view.getUint32(offs + 0x0C, true);
        const dataOffs = view.getUint32(offs + 0x10, true);
        const name = readString(buffer, offs + 0x14, 0x10);
        offs += 0x24;

        const pixels = decodeTexture(width, height, format, texData.slice(dataOffs, dataOffs + size));

        cmb.textures.push({ size, width, height, format, name, pixels });
    }
}

function readVatrChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'vatr');

    let idx = 0x0C;

    const posSize = view.getUint32(idx + 0x00, true);
    const posOffs = view.getUint32(idx + 0x04, true);
    const posBuffer = buffer.subarray(posOffs, posSize);
    idx += 0x08;

    const nrmSize = view.getUint32(idx + 0x00, true);
    const nrmOffs = view.getUint32(idx + 0x04, true);
    const nrmBuffer = buffer.subarray(nrmOffs, nrmSize);
    idx += 0x08;

    if (cmb.version === Version.Majora)
        idx += 0x08;

    const colSize = view.getUint32(idx + 0x00, true);
    const colOffs = view.getUint32(idx + 0x04, true);
    const colBuffer = buffer.subarray(colOffs, colSize);
    idx += 0x08;

    const txcSize = view.getUint32(idx + 0x00, true);
    const txcOffs = view.getUint32(idx + 0x04, true);
    const txcBuffer = buffer.subarray(txcOffs, txcSize);
    idx += 0x08;

    cmb.vertexBufferSlices = { posBuffer, nrmBuffer, colBuffer, txcBuffer };
}

export class Mesh {
    public sepdIdx: number;
    public matsIdx: number;
}

function readMshsChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'mshs');
    const count = view.getUint32(0x08, true);
    let idx = 0x10;
    for (let i = 0; i < count; i++) {
        const mesh = new Mesh();
        mesh.sepdIdx = view.getUint16(idx, true);
        mesh.matsIdx = view.getUint8(idx + 0x02);
        cmb.meshs.push(mesh);
        idx += 0x04;

        if (cmb.version === Version.Majora)
            idx += 0x08;
    }
}

export enum DataType {
    Byte   = 0x1400,
    UByte  = 0x1401,
    Short  = 0x1402,
    UShort = 0x1403,
    Int    = 0x1404,
    UInt   = 0x1405,
    Float  = 0x1406,
}

export class Prm {
    public indexType: DataType;
    public count: number;
    public offset: number;
}

function readPrmChunk(cmb: CMB, buffer: ArrayBufferSlice): Prm {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prm ');

    const prm = new Prm();
    prm.indexType = view.getUint32(0x10, true);
    prm.count = view.getUint16(0x14, true);
    // No idea why this is always specified in terms of shorts, even when the indexType is byte...
    prm.offset = view.getUint16(0x16, true) * 2;

    return prm;
}

export const enum SkinningMode {
    SINGLE_BONE = 0x00,
    PER_VERTEX = 0x01,
    PER_VERTEX_NO_TRANS = 0x02,
}

export interface Prms {
    prm: Prm;
    skinningMode: SkinningMode;
    boneTable: Uint16Array;
}

function readPrmsChunk(cmb: CMB, buffer: ArrayBufferSlice): Prms {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'prms');

    const skinningMode: SkinningMode = view.getUint16(0x0C, true);
    if (skinningMode !== SkinningMode.SINGLE_BONE)
        console.warn("Found complex skinning case");

    const boneTableCount = view.getUint16(0x0E, true);
    const boneTable = new Uint16Array(boneTableCount);

    const prmOffs = view.getUint32(0x14, true);

    const prm = readPrmChunk(cmb, buffer.slice(prmOffs));

    let boneTableIdx = view.getUint32(0x10, true);
    for (let i = 0; i < boneTableCount; i++) {
        boneTable[i] = view.getUint16(boneTableIdx, true);
        boneTableIdx += 0x02;
    }

    return { prm, skinningMode, boneTable };
}

export class Sepd {
    public prms: Prms[] = [];

    public posStart: number;
    public posScale: number;
    public posType: DataType;

    public nrmStart: number;
    public nrmScale: number;
    public nrmType: DataType;

    public colStart: number;
    public colScale: number;
    public colType: DataType;

    public txcStart: number;
    public txcScale: number;
    public txcType: DataType;
}

function readSepdChunk(cmb: CMB, buffer: ArrayBufferSlice): Sepd {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sepd');
    const count = view.getUint16(0x08, true);

    const sepd = new Sepd();

    let sepdArrIdx = 0x24;

    sepd.posStart = view.getUint32(sepdArrIdx + 0x00, true);
    sepd.posScale = view.getFloat32(sepdArrIdx + 0x04, true);
    sepd.posType = view.getUint16(sepdArrIdx + 0x08, true);
    sepdArrIdx += 0x1C;

    sepd.nrmStart = view.getUint32(sepdArrIdx + 0x00, true);
    sepd.nrmScale = view.getFloat32(sepdArrIdx + 0x04, true);
    sepd.nrmType = view.getUint16(sepdArrIdx + 0x08, true);
    sepdArrIdx += 0x1C;

    if (cmb.version === Version.Majora)
        sepdArrIdx += 0x1C;

    sepd.colStart = view.getUint32(sepdArrIdx + 0x00, true);
    sepd.colScale = view.getFloat32(sepdArrIdx + 0x04, true);
    sepd.colType = view.getUint16(sepdArrIdx + 0x08, true);
    sepdArrIdx += 0x1C;

    sepd.txcStart = view.getUint32(sepdArrIdx + 0x00, true);
    sepd.txcScale = view.getFloat32(sepdArrIdx + 0x04, true);
    sepd.txcType = view.getUint16(sepdArrIdx + 0x08, true);
    sepdArrIdx += 0x1C;

    let offs = cmb.version === Version.Majora ? 0x124 : 0x108;
    for (let i = 0; i < count; i++) {
        const prmsOffs = view.getUint16(offs, true);
        sepd.prms.push(readPrmsChunk(cmb, buffer.slice(prmsOffs)));
        offs += 0x02;
    }

    return sepd;
}

function readShpChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'shp ');
    const count = view.getUint32(0x08, true);

    let offs = 0x10;
    for (let i = 0; i < count; i++) {
        const sepdOffs = view.getUint16(offs, true);
        const sepd = readSepdChunk(cmb, buffer.slice(sepdOffs));
        cmb.sepds.push(sepd);
        offs += 0x02;
    }
}

function readSklmChunk(cmb: CMB, buffer: ArrayBufferSlice): void {
    const view = buffer.createDataView();

    assert(readString(buffer, 0x00, 0x04) === 'sklm');
    const mshsChunkOffs = view.getUint32(0x08, true);
    readMshsChunk(cmb, buffer.slice(mshsChunkOffs));

    const shpChunkOffs = view.getUint32(0x0C, true);
    readShpChunk(cmb, buffer.slice(shpChunkOffs));
}

export function parse(buffer: ArrayBufferSlice): CMB {
    const view = buffer.createDataView();
    const cmb = new CMB();

    assert(readString(buffer, 0x00, 0x04) === 'cmb ');

    const size = view.getUint32(0x04, true);
    cmb.name = readString(buffer, 0x10, 0x10);

    const numChunks = view.getUint32(0x08, true);
    cmb.version = (numChunks === 0x0A) ? Version.Majora : Version.Ocarina;

    let chunkIdx = 0x24;

    const sklChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklChunk(cmb, buffer.slice(sklChunkOffs));

    if (cmb.version === Version.Majora)
        chunkIdx += 0x04; // Qtrs

    const matsChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readMatsChunk(cmb, buffer.slice(matsChunkOffs));

    const texDataOffs = view.getUint32(chunkIdx + 0x14, true);

    const texChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readTexChunk(cmb, buffer.slice(texChunkOffs), buffer.slice(texDataOffs));

    const sklmChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readSklmChunk(cmb, buffer.slice(sklmChunkOffs));

    chunkIdx += 0x04; // Luts

    const vatrChunkOffs = view.getUint32(chunkIdx, true);
    chunkIdx += 0x04;
    readVatrChunk(cmb, buffer.slice(vatrChunkOffs));

    const idxDataOffs = view.getUint32(chunkIdx, true);

    const idxDataCount = view.getUint32(0x20, true);
    cmb.indexBuffer = buffer.slice(idxDataOffs, idxDataOffs + idxDataCount * 2);

    return cmb;
}
