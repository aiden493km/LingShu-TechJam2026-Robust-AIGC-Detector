import unittest
import warnings
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import torch

from web_model_experiment import compare_probabilities


class CompareProbabilitiesTests(unittest.TestCase):
    def test_reports_error_and_frozen_threshold_flips(self):
        report = compare_probabilities(
            reference=[0.10, 0.60, 0.90],
            candidate=[0.12, 0.50, 0.91],
            threshold=0.55657113,
        )

        self.assertEqual(report["sample_count"], 3)
        self.assertAlmostEqual(report["max_abs_error"], 0.10)
        self.assertAlmostEqual(report["mean_abs_error"], 0.13 / 3)
        self.assertEqual(report["threshold_flip_count"], 1)
        self.assertEqual(report["threshold_flip_indices"], [1])

    def test_rejects_mismatched_probability_counts(self):
        with self.assertRaisesRegex(ValueError, "same number"):
            compare_probabilities(
                reference=[0.1, 0.9],
                candidate=[0.1],
                threshold=0.55657113,
            )

    def test_rejects_empty_probability_lists(self):
        with self.assertRaisesRegex(ValueError, "at least one"):
            compare_probabilities(
                reference=[],
                candidate=[],
                threshold=0.55657113,
            )


class OnnxPipelineTests(unittest.TestCase):
    @staticmethod
    def _tiny_model_and_inputs():
        torch.manual_seed(7)
        model = torch.nn.Sequential(
            torch.nn.Linear(4, 3),
            torch.nn.GELU(),
            torch.nn.Linear(3, 1),
        ).eval()
        inputs = torch.tensor(
            [[0.25, -0.50, 0.75, 1.00], [-1.00, 0.50, 0.25, -0.25]],
            dtype=torch.float32,
        )
        return model, inputs

    def test_exported_fp32_model_matches_pytorch(self):
        from web_model_experiment import export_fp32_onnx, run_onnx_logits

        model, inputs = self._tiny_model_and_inputs()

        with torch.inference_mode():
            expected = model(inputs).numpy()

        with TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "tiny-fp32.onnx"
            with warnings.catch_warnings(record=True) as captured_warnings:
                warnings.simplefilter("always")
                export_fp32_onnx(model, inputs[:1], output_path)
            actual, _ = run_onnx_logits(output_path, inputs.numpy())

        self.assertEqual(
            [
                (warning.category.__name__, str(warning.message))
                for warning in captured_warnings
            ],
            [],
        )
        self.assertTrue(output_path.name.endswith(".onnx"))
        self.assertEqual(actual.shape, expected.shape)
        self.assertLess(float(abs(actual - expected).max()), 1e-5)

    def test_fp32_export_supports_fixed_browser_batch(self):
        from web_model_experiment import export_fp32_onnx, run_onnx_logits

        model, inputs = self._tiny_model_and_inputs()
        with torch.inference_mode():
            expected = model(inputs[:1]).numpy()

        with TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "tiny-fixed-fp32.onnx"
            export_fp32_onnx(
                model,
                inputs[:1],
                output_path,
                dynamic_batch=False,
            )
            actual, _ = run_onnx_logits(output_path, inputs[:1].numpy())

        self.assertEqual(actual.shape, expected.shape)
        self.assertLess(float(abs(actual - expected).max()), 1e-5)

    def test_fixed_browser_model_runs_multiple_samples_sequentially(self):
        from web_model_experiment import export_fp32_onnx, run_onnx_batches

        model, inputs = self._tiny_model_and_inputs()
        with torch.inference_mode():
            expected = model(inputs).numpy()

        with TemporaryDirectory() as temporary_directory:
            output_path = Path(temporary_directory) / "tiny-fixed-fp32.onnx"
            export_fp32_onnx(
                model,
                inputs[:1],
                output_path,
                dynamic_batch=False,
            )
            actual, timings = run_onnx_batches(
                output_path,
                inputs.numpy(),
                batch_size=1,
            )

        self.assertEqual(actual.shape, expected.shape)
        self.assertLess(float(abs(actual - expected).max()), 1e-5)
        self.assertEqual(timings["sample_count"], 2)
        self.assertEqual(timings["batch_size"], 1)

    def test_fp16_conversion_preserves_toy_model_outputs(self):
        from web_model_experiment import (
            convert_fp16_onnx,
            export_fp32_onnx,
            run_onnx_logits,
        )

        model, inputs = self._tiny_model_and_inputs()
        with torch.inference_mode():
            expected = model(inputs).numpy()

        with TemporaryDirectory() as temporary_directory:
            fp32_path = Path(temporary_directory) / "tiny-fp32.onnx"
            fp16_path = Path(temporary_directory) / "tiny-fp16.onnx"
            export_fp32_onnx(model, inputs[:1], fp32_path)
            convert_fp16_onnx(fp32_path, fp16_path)
            actual, _ = run_onnx_logits(fp16_path, inputs.numpy())

        self.assertEqual(actual.shape, expected.shape)
        self.assertLess(float(abs(actual - expected).max()), 1e-3)

    def test_int8_quantization_preserves_toy_model_outputs(self):
        from web_model_experiment import (
            export_fp32_onnx,
            quantize_int8_onnx,
            run_onnx_logits,
        )

        model, inputs = self._tiny_model_and_inputs()
        with torch.inference_mode():
            expected = model(inputs[:1]).numpy()

        with TemporaryDirectory() as temporary_directory:
            fp32_path = Path(temporary_directory) / "tiny-fp32.onnx"
            int8_path = Path(temporary_directory) / "tiny-int8.onnx"
            export_fp32_onnx(
                model,
                inputs[:1],
                fp32_path,
                dynamic_batch=False,
            )
            quantize_int8_onnx(fp32_path, int8_path)
            actual, _ = run_onnx_logits(int8_path, inputs[:1].numpy())

        self.assertEqual(actual.shape, expected.shape)
        self.assertLess(float(abs(actual - expected).max()), 0.02)

    def test_int8_quantization_supports_per_channel_reduce_range(self):
        from web_model_experiment import export_fp32_onnx, quantize_int8_onnx

        model, inputs = self._tiny_model_and_inputs()
        with TemporaryDirectory() as temporary_directory:
            fp32_path = Path(temporary_directory) / "tiny-fp32.onnx"
            int8_path = Path(temporary_directory) / "tiny-int8-per-channel.onnx"
            export_fp32_onnx(
                model,
                inputs[:1],
                fp32_path,
                dynamic_batch=False,
            )
            quantize_int8_onnx(
                fp32_path,
                int8_path,
                per_channel=True,
                reduce_range=True,
            )

            self.assertTrue(int8_path.is_file())
            self.assertGreater(int8_path.stat().st_size, 0)


class BrowserFixtureTests(unittest.TestCase):
    def test_writes_float32_tensor_and_anonymous_metadata(self):
        from web_model_experiment import write_browser_fixture

        inputs = np.arange(24, dtype=np.float32).reshape(2, 3, 2, 2)
        with TemporaryDirectory() as temporary_directory:
            output_prefix = Path(temporary_directory) / "demo"
            metadata = write_browser_fixture(
                output_prefix,
                inputs=inputs,
                probabilities=[0.25, 0.75],
            )

            binary = np.fromfile(
                output_prefix.with_name("demo_inputs_f32.bin"),
                dtype=np.float32,
            ).reshape(2, 3, 2, 2)

        np.testing.assert_array_equal(binary, inputs)
        self.assertEqual(metadata["names"], ["sample_000", "sample_001"])
        self.assertEqual(metadata["shape"], [2, 3, 2, 2])
        self.assertEqual(metadata["reference_probabilities"], [0.25, 0.75])


class CommandLineTests(unittest.TestCase):
    def test_parser_exposes_reproducible_experiment_inputs(self):
        from web_model_experiment import build_argument_parser

        arguments = build_argument_parser().parse_args(
            [
                "--checkpoint",
                "checkpoint.pt",
                "--images",
                "demo_images",
            ]
        )

        self.assertEqual(arguments.checkpoint, Path("checkpoint.pt"))
        self.assertEqual(arguments.images, Path("demo_images"))
        self.assertEqual(arguments.model_dir, Path("web_models"))
        self.assertEqual(arguments.fixture_name, "demo")

if __name__ == "__main__":
    unittest.main()
