"""Utilities for validating browser-deployable model variants."""

import argparse
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from time import perf_counter
import warnings


def compare_probabilities(reference, candidate, threshold):
    """Compare candidate probabilities against the frozen reference output."""
    if len(reference) != len(candidate):
        raise ValueError("reference and candidate must contain the same number of values")
    if not reference:
        raise ValueError("probability lists must contain at least one value")

    absolute_errors = [
        abs(reference_value - candidate_value)
        for reference_value, candidate_value in zip(reference, candidate)
    ]
    threshold_flip_indices = [
        index
        for index, (reference_value, candidate_value) in enumerate(
            zip(reference, candidate)
        )
        if (reference_value >= threshold) != (candidate_value >= threshold)
    ]

    return {
        "sample_count": len(absolute_errors),
        "max_abs_error": max(absolute_errors),
        "mean_abs_error": sum(absolute_errors) / len(absolute_errors),
        "threshold_flip_count": len(threshold_flip_indices),
        "threshold_flip_indices": threshold_flip_indices,
    }


def export_fp32_onnx(
    model,
    example_input,
    output_path,
    *,
    opset_version=18,
    dynamic_batch=True,
):
    """Export a PyTorch model with float32 inputs and dynamic batch size."""
    import torch

    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    model.eval()

    dynamic_shapes = None
    if dynamic_batch:
        batch_dimension = torch.export.Dim("batch")
        dynamic_shapes = ({0: batch_dimension},)

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore",
            message=r"`isinstance\(treespec, LeafSpec\)` is deprecated.*",
            category=FutureWarning,
        )
        torch.onnx.export(
            model,
            (example_input,),
            str(output_path),
            input_names=["input"],
            output_names=["logits"],
            dynamic_shapes=dynamic_shapes,
            opset_version=opset_version,
            dynamo=True,
            external_data=False,
            verbose=False,
        )
    return output_path


def run_onnx_logits(model_path, inputs):
    """Run ONNX Runtime on CPU and return logits plus measured timings."""
    import onnxruntime as ort

    initialization_started = perf_counter()
    session = ort.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
    )
    initialization_seconds = perf_counter() - initialization_started

    inference_started = perf_counter()
    logits = session.run(
        None,
        {session.get_inputs()[0].name: inputs},
    )[0]
    inference_seconds = perf_counter() - inference_started

    return logits, {
        "initialization_seconds": initialization_seconds,
        "inference_seconds": inference_seconds,
        "provider": session.get_providers()[0],
    }


def run_onnx_batches(model_path, inputs, *, batch_size):
    """Run a model over multiple samples while reusing one ONNX session."""
    import numpy as np
    import onnxruntime as ort

    initialization_started = perf_counter()
    session = ort.InferenceSession(
        str(model_path),
        providers=["CPUExecutionProvider"],
    )
    initialization_seconds = perf_counter() - initialization_started

    input_name = session.get_inputs()[0].name
    batch_logits = []
    batch_seconds = []
    for start in range(0, len(inputs), batch_size):
        batch = inputs[start : start + batch_size]
        inference_started = perf_counter()
        batch_logits.append(session.run(None, {input_name: batch})[0])
        batch_seconds.append(perf_counter() - inference_started)

    logits = np.concatenate(batch_logits, axis=0)
    inference_seconds = sum(batch_seconds)
    return logits, {
        "initialization_seconds": initialization_seconds,
        "inference_seconds": inference_seconds,
        "average_seconds_per_sample": inference_seconds / len(inputs),
        "batch_seconds": batch_seconds,
        "sample_count": len(inputs),
        "batch_size": batch_size,
        "provider": session.get_providers()[0],
    }


def convert_fp16_onnx(fp32_path, fp16_path):
    """Convert ONNX internal tensors to float16 while keeping float32 I/O."""
    import onnx
    from onnxconverter_common import float16

    fp16_path = Path(fp16_path)
    fp16_path.parent.mkdir(parents=True, exist_ok=True)
    model = onnx.load(str(fp32_path))
    converted_model = float16.convert_float_to_float16(
        model,
        keep_io_types=True,
    )
    onnx.checker.check_model(converted_model)
    onnx.save(converted_model, str(fp16_path))
    return fp16_path


def quantize_int8_onnx(
    fp32_path,
    int8_path,
    *,
    per_channel=False,
    reduce_range=False,
):
    """Apply ONNX Runtime dynamic int8 weight quantization."""
    from onnxruntime.quantization import QuantType, quantize_dynamic
    from onnxruntime.quantization.shape_inference import quant_pre_process

    int8_path = Path(int8_path)
    int8_path.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="web-model-quantization-") as temporary_directory:
        preprocessed_path = Path(temporary_directory) / "preprocessed.onnx"
        quant_pre_process(
            input_model=str(fp32_path),
            output_model_path=str(preprocessed_path),
        )
        quantize_dynamic(
            model_input=str(preprocessed_path),
            model_output=str(int8_path),
            per_channel=per_channel,
            reduce_range=reduce_range,
            weight_type=QuantType.QInt8,
        )
    return int8_path


def write_browser_fixture(output_prefix, *, inputs, probabilities):
    """Write anonymous float32 browser inputs and their reference scores."""
    import numpy as np

    inputs = np.ascontiguousarray(inputs, dtype=np.float32)
    probabilities = [float(value) for value in probabilities]
    if len(inputs) != len(probabilities):
        raise ValueError("inputs and probabilities must contain the same number of samples")

    output_prefix = Path(output_prefix)
    output_prefix.parent.mkdir(parents=True, exist_ok=True)
    binary_path = output_prefix.with_name(
        f"{output_prefix.name}_inputs_f32.bin"
    )
    metadata_path = output_prefix.with_name(
        f"{output_prefix.name}_inputs.json"
    )
    inputs.tofile(binary_path)
    metadata = {
        "names": [f"sample_{index:03d}" for index in range(len(inputs))],
        "shape": list(inputs.shape),
        "dtype": "float32",
        "bytes": binary_path.stat().st_size,
        "reference_probabilities": probabilities,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    return metadata


def build_argument_parser():
    parser = argparse.ArgumentParser(
        description="Export and validate browser-deployable B2-NJR model variants.",
    )
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--images", required=True, type=Path)
    parser.add_argument("--model-dir", type=Path, default=Path("web_models"))
    parser.add_argument("--fixture-name", default="demo")
    return parser


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as file_handle:
        for chunk in iter(lambda: file_handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_experiment(arguments):
    """Run the reproducible Python export and local parity experiment."""
    import torch

    from inference import (
        FROZEN_THRESHOLD,
        collect_images,
        load_model,
        preprocess_image,
    )

    model_dir = arguments.model_dir.resolve()
    model_dir.mkdir(parents=True, exist_ok=True)
    image_paths = collect_images(arguments.images.resolve())
    if not image_paths:
        raise ValueError(f"No supported images found in {arguments.images}")

    inputs = torch.stack([preprocess_image(path) for path in image_paths])
    model = load_model(arguments.checkpoint.resolve(), torch.device("cpu"))
    reference_started = perf_counter()
    with torch.inference_mode():
        reference_probabilities = torch.sigmoid(model(inputs)).flatten().tolist()
    reference_seconds = perf_counter() - reference_started

    write_browser_fixture(
        model_dir / arguments.fixture_name,
        inputs=inputs.numpy(),
        probabilities=reference_probabilities,
    )

    fp32_path = model_dir / "baseline2_njr_fp32.onnx"
    fp16_path = model_dir / "baseline2_njr_fp16.onnx"
    int8_path = model_dir / "baseline2_njr_int8.onnx"
    int8_per_channel_path = model_dir / "baseline2_njr_int8_per_channel.onnx"
    int8_reduce_range_path = (
        model_dir / "baseline2_njr_int8_per_channel_reduce_range.onnx"
    )

    export_fp32_onnx(
        model,
        inputs[:1],
        fp32_path,
        dynamic_batch=False,
    )
    convert_fp16_onnx(fp32_path, fp16_path)
    quantize_int8_onnx(fp32_path, int8_path)
    quantize_int8_onnx(
        fp32_path,
        int8_per_channel_path,
        per_channel=True,
    )
    quantize_int8_onnx(
        fp32_path,
        int8_reduce_range_path,
        per_channel=True,
        reduce_range=True,
    )

    numpy_inputs = inputs.numpy()
    variants = {
        "fp32": fp32_path,
        "int8": int8_path,
        "int8_per_channel": int8_per_channel_path,
        "int8_per_channel_reduce_range": int8_reduce_range_path,
    }
    local_results = {}
    for name, model_path in variants.items():
        logits, timings = run_onnx_batches(
            model_path,
            numpy_inputs,
            batch_size=1,
        )
        probabilities = torch.sigmoid(torch.from_numpy(logits)).flatten().tolist()
        local_results[name] = {
            "model_bytes": model_path.stat().st_size,
            "comparison": compare_probabilities(
                reference_probabilities,
                probabilities,
                FROZEN_THRESHOLD,
            ),
            "timings": timings,
        }

    report = {
        "checkpoint": {
            "file": arguments.checkpoint.name,
            "bytes": arguments.checkpoint.stat().st_size,
            "sha256": _sha256(arguments.checkpoint),
        },
        "input": {
            "sample_count": len(image_paths),
            "shape": list(inputs.shape),
        },
        "frozen_threshold": FROZEN_THRESHOLD,
        "pytorch": {
            "inference_seconds": reference_seconds,
            "average_seconds_per_sample": reference_seconds / len(image_paths),
        },
        "model_sizes": {
            "fp32": fp32_path.stat().st_size,
            "fp16": fp16_path.stat().st_size,
            "int8": int8_path.stat().st_size,
            "int8_per_channel": int8_per_channel_path.stat().st_size,
            "int8_per_channel_reduce_range": int8_reduce_range_path.stat().st_size,
        },
        "local_onnxruntime": local_results,
        "note": "FP16 is benchmarked in WebGPU, not ONNX Runtime CPU.",
    }
    report_path = model_dir / "python_experiment_report.json"
    report_path.write_text(
        json.dumps(report, indent=2) + "\n",
        encoding="utf-8",
    )
    return report


def main():
    arguments = build_argument_parser().parse_args()
    report = run_experiment(arguments)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
