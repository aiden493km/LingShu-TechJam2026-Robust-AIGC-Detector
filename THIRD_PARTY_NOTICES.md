# Third-Party Notices

This file is an evidence-based inventory of third-party material currently used or
redistributed by the project. It is not a legal-compliance certification. Package
versions and license identifications below were checked against the locally
installed npm package metadata and license/codec-notice files used to build the
committed WebDemo distribution.

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

The initial detector used in this project is:

```text
OwensLab/commfor-model-384
```

The final submitted model is a robustness-aware fine-tuned checkpoint derived from that detector.

Before public release, ensure that any model-weight redistribution also complies with the applicable upstream model and dataset terms.

This model-weight and dataset-term review remains unresolved. Nothing in the
browser-runtime inventory below should be read as clearing the model weights for
public redistribution.

## Committed browser runtime

The committed `web_demo/dist/` build contains runtime code from these direct
dependencies:

| Component | Version | Redistributed use | License and attribution |
|---|---:|---|---|
| ONNX Runtime Web | 1.29.0 | Browser WebGPU/WASM inference, including `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm` | MIT; Copyright Microsoft Corporation. The local npm metadata declares MIT and a JavaScript bundle in that installed package carries the Microsoft MIT header. |
| React | 19.2.8 | Browser UI bundle | MIT; Copyright Meta Platforms, Inc. and affiliates. |
| React DOM | 19.2.8 | Browser DOM renderer | MIT; Copyright Meta Platforms, Inc. and affiliates. |
| `@jsquash/jpeg` | 1.6.0 | JPEG decode | Apache License 2.0 for the package; codec notice detailed below. |
| `@jsquash/png` | 3.1.1 | PNG decode | Apache License 2.0 for the package; codec notice detailed below. |
| `@jsquash/resize` | 2.1.1 | Browser resize | Apache License 2.0 for the package; bundled resize-module notices detailed below. |
| `@jsquash/webp` | 1.5.0 | WebP decode | Apache License 2.0 for the package; codec notice detailed below. |

The jSquash package readmes identify codec/supporting code as derived from the
GoogleChromeLabs Squoosh project. The package JavaScript notices include Copyright
2020 Google Inc. under Apache License 2.0. The Apache License 2.0 text is available
at <https://www.apache.org/licenses/LICENSE-2.0>.

Build-only and test-only packages are not listed in this runtime table because they
are not shipped as the judge-facing browser application.

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

Before a public release, preserve the applicable complete license texts and notices
with redistributed browser assets and review the full production dependency graph.
This repository-level summary does not replace that release review, and it does not
resolve the separate upstream model-weight and dataset terms described above.
