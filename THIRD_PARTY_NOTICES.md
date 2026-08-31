# Third-Party Notices

This file is an evidence-based inventory of third-party material currently used or
redistributed by the project. It is not a legal-compliance certification. Package
versions and license identifications below were checked against the locally
installed npm package metadata and license/codec-notice files used to build the
committed WebDemo distribution.

## Project-specific code license

The root [`LICENSE`](LICENSE) licenses original LingShu Intelligence project code
and original documentation under the MIT License, unless an individual file states
otherwise. It does not apply to or relicense third-party code, model components,
datasets, codecs, browser dependencies, bundled runtimes, or other third-party
assets, which remain subject to their respective licenses and terms.

## Community Forensics

This project builds on and adapts code and model definitions from the **Community Forensics** project by Jeongsoo Park and collaborators.

Upstream repository:

```text
https://github.com/JeongsooP/Community-Forensics
```

The upstream project is distributed under the MIT License.

The adapted model definition in this repository retains attribution to Community Forensics. The original upstream license should be preserved with redistributed or adapted portions as required by the MIT License.

For clarity, the TikTok TechJam project-specific training, robustness ablation, evaluation, deployment, data-integrity, and reporting code in this repository is separate from the upstream project.

## Model provenance

The initial detector was loaded from:

```text
OwensLab/commfor-model-384
```

The training scripts did not pass a Hugging Face `revision`, and the frozen
protocol/manifest did not record the resolved Hub commit. The exact historical
base-model revision is therefore unproven. During the 2026-08-30 documentation
review, the then-current upstream commit
`6076002bf0d9dd37537f965ee2f06f826c333b61` identified the model as MIT-licensed;
that observation is provenance context, not retroactive proof of the training
revision. The final submitted `.pt` checkpoint and its FP32 ONNX export are
robustness-aware fine-tuned derivatives of the named detector.

The fine-tuning used directories named SID and WildFake. The training records in
this repository do not capture dataset URLs, revisions, a source manifest, or
sample hashes, so those local names cannot be proven to match a particular public
release.

During the 2026-08-30 review, the current
[`saberzl/SID_Set`](https://huggingface.co/datasets/saberzl/SID_Set) page identified
that release as CC BY 4.0. The WildFake paper points to its
[official repository](https://github.com/hy-zpg/AIGC-Image-Detection-Dataset), and
the current [ModelScope metadata](https://modelscope.cn/openapi/v1/datasets/hy2628982280/WildFake)
identified the hosted dataset as Apache License 2.0. These are useful candidate
references, not proof of the exact data used locally or a complete clearance of
all underlying images.

The [WildFake paper](https://ojs.aaai.org/index.php/AAAI/article/download/32363/34518)
describes a mixture of generated-community images and several third-party real
image datasets. SID_Set also incorporates sources whose own notices differ: the
[Open Images site](https://storage.googleapis.com/openimages/web/download_v4.html)
uses per-image CC BY 2.0 metadata, while the
[Flickr30k page](https://shannon.cs.illinois.edu/DenotationGraph/data/index.html)
states that image copyrights remain with their owners and imposes its own use
conditions. A dataset-level metadata label therefore cannot, by itself, settle
every underlying right or whether trained weights are treated as an adaptation in
the relevant jurisdiction.

### Known unresolved redistribution risk and team release decision

The historical dataset releases, subsets, and complete applicable terms used for
training remain unproven. The upstream model's MIT metadata and the candidate
dataset metadata above do not resolve how all underlying terms apply to the trained
`.pt` checkpoint or its ONNX export.

As of 2026-08-31, the team explicitly chose to proceed with v1.2.0 public
redistribution while preserving this unresolved-risk disclosure. That decision is
not a legal-compliance certification, does not establish legal clearance, and does
not relicense any underlying model, dataset, image, or other third-party asset.
Nothing in the browser-runtime inventory below resolves this model-weight and
dataset provenance risk.

## Bundled judge Python runtimes

The following upstream archives are redistributed unchanged in
`web_demo/runtimes/` for offline judge startup:

- `windows-x86_64-python.zip` is the CPython 3.12.10 Windows embeddable package
  published by the Python Software Foundation under the PSF License Version 2.
  Source: `https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip`;
  11,133,606 bytes; SHA-256
  `4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3`.
  The archive retains `LICENSE.txt`.
- `macos-arm64-python.tar.gz` is the Astral `python-build-standalone` CPython
  3.12.14 aarch64 Apple Darwin install-only stripped archive from the 20260825
  release. Source:
  `https://github.com/astral-sh/python-build-standalone/releases/download/20260825/cpython-3.12.14%2B20260825-aarch64-apple-darwin-install_only_stripped.tar.gz`;
  24,970,238 bytes; SHA-256
  `8b0f1fa71eab7ca644e482c631807a1116fa848491051cd1c8d9429491de63a6`.
  The archive retains CPython's `python/lib/python3.12/LICENSE.txt`, pip's
  `python/lib/python3.12/site-packages/pip-26.2.1.dist-info/licenses/AUTHORS.txt`
  and `python/lib/python3.12/site-packages/pip-26.2.1.dist-info/licenses/LICENSE.txt`,
  and the bundled dependency license files under
  `python/lib/python3.12/site-packages/pip-26.2.1.dist-info/licenses/src/pip/_vendor/`
  and `python/lib/python3.12/site-packages/pip/_vendor/`.

## Committed browser runtime

The committed `web_demo/dist/` build contains runtime code associated with these
primary components:

| Component | Version | Redistributed use | License and attribution |
|---|---:|---|---|
| ONNX Runtime Web | 1.29.0 | Browser WebGPU/WASM inference, including `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm` | MIT; Copyright Microsoft Corporation. The local npm metadata declares MIT and a JavaScript bundle in that installed package carries the Microsoft MIT header. |
| React | 19.2.8 | Browser UI bundle | MIT; Copyright Meta Platforms, Inc. and affiliates. |
| React DOM | 19.2.8 | Browser DOM renderer | MIT; Copyright Meta Platforms, Inc. and affiliates. |
| Scheduler | 0.27.0 | Transitive React DOM scheduler code included in the browser bundle | MIT; Copyright Meta Platforms, Inc. and affiliates. |
| `@jsquash/jpeg` | 1.6.0 | JPEG decode | Apache License 2.0 for the package; codec notice detailed below. |
| `@jsquash/png` | 3.1.1 | PNG decode | Apache License 2.0 for the package; codec notice detailed below. |
| `@jsquash/resize` | 2.1.1 | Browser resize | Apache License 2.0 for the package; bundled resize-module notices detailed below. |
| `@jsquash/webp` | 1.5.0 | WebP decode | Apache License 2.0 for the package; codec notice detailed below. |
| Vite | 8.2.2 | Build-generated modulepreload compatibility helper present in the browser bundle | MIT; build-tool output must remain in the actual-bundle license audit. |

The jSquash package readmes identify codec/supporting code as derived from the
GoogleChromeLabs Squoosh project. The package JavaScript notices include Copyright
2020 Google Inc. under Apache License 2.0. The Apache License 2.0 text is available
at <https://www.apache.org/licenses/LICENSE-2.0>.

The production lock also resolves these runtime/transitive packages: `flatbuffers`
25.9.23, `guid-typescript` 1.0.9, `long` 5.3.2, `onnxruntime-common` 1.29.0,
`platform` 1.3.6, `protobufjs` 7.6.6 and its `@protobufjs/*` helpers,
`wasm-feature-detect` 1.9.0, plus type-only packages selected by npm's production
tree. Most build-only and test-only packages are not installed by judges as runtime
packages, but generated code such as Vite's modulepreload helper can still be
present in `dist`; this is why the actual production bundle remains the release
audit boundary.

## Browser codec and resize notices

The following attributions come from the `LICENSE.codec.md` files shipped inside
the exact jSquash package versions above. The asset names identify the corresponding
files in the current committed `web_demo/dist/assets/` directory.

### JPEG decoder (`mozjpeg_dec-muSO2n8T.wasm`)

The `@jsquash/jpeg` codec notice identifies libjpeg-turbo material covered by the
IJG License, the Modified 3-clause BSD License, and the zlib License. It requires
binary-product documentation to state:

> This software is based in part on the work of the Independent JPEG Group.

The same local notice carries these copyright statements for its Modified BSD
portion:

```text
Copyright (C)2009-2020 D. R. Commander. All Rights Reserved.
Copyright (C)2015 Viktor Szathmáry. All Rights Reserved.
```

Redistribution and use in source and binary forms, with or without modification,
are permitted subject to retaining the copyright notice, conditions, and
disclaimer; reproducing them with binary distributions; and not using the
libjpeg-turbo Project or contributor names for endorsement without prior written
permission. The software is provided "AS IS", without warranty, and the copyright
holders and contributors disclaim liability as stated in the local codec notice.

### PNG and WebP decoders

The current `squoosh_png_bg-DAY7U9NW.wasm` and `webp_dec-C990n7mh.wasm` assets each
ship with the same local 3-clause BSD codec notice:

```text
Copyright (c) 2010, Google Inc. All rights reserved.
```

Redistribution and use in source and binary forms, with or without modification,
are permitted subject to retaining the copyright notice, conditions, and
disclaimer; reproducing them with binary distributions; and not using Google or
contributor names for endorsement without prior written permission. The software
is provided "AS IS", without warranty, and the copyright holder and contributors
disclaim liability as stated in those local codec notices.

### Resize modules

The committed build currently contains three jSquash resize WASM assets:

- `squoosh_resize_bg-YY9xfwUg.wasm`: MIT License; Copyright (c) 2015
  PistonDevelopers.
- `squooshhqx_bg-jpRtGvMp.wasm`: Apache License 2.0.
- `jsquash_magic_kernel_bg-Cq4C4bH5.wasm`: MIT License; Copyright (c) 2024
  Serhii Tatarintsev.

The MIT notices grant permission to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies provided that the copyright and permission notice
are included in all copies or substantial portions. They provide the software
"AS IS" without warranty and disclaim liability.

## Redistribution follow-up

### v1.2.0 packaging verification

The published v1.2.0 packages include the complete applicable license and notice texts
alongside the browser assets, including ONNX Runtime 1.29.0's MIT license and pinned
`ThirdPartyNotices.txt`, React/React DOM/Scheduler MIT licenses, jSquash Apache-2.0
licenses, and the original codec/resize notices. Their presence and completeness were
verified against the final package contents before upload. Audit the locked production
graph above against the actual bundle after every dependency or build change. This
repository-level summary does not replace that packaging verification and does not
resolve the separate model-weight and dataset provenance risk above.
