"""
Model definition for TikTok TechJam 2026 Track 5.

The ViT backbone definition is adapted from Community Forensics:
https://github.com/JeongsooP/Community-Forensics

For final local inference, instantiate ViTClassifier with
pretrained_backbone=False and then load the frozen B2-NJR checkpoint.
This avoids any network access during inference.
"""

import torch
import torch.nn as nn
import timm
from huggingface_hub import PyTorchModelHubMixin


class ViTClassifier(nn.Module, PyTorchModelHubMixin):
    def __init__(
        self,
        model_size="small",
        input_size=384,
        patch_size=16,
        freeze_backbone=False,
        device="cpu",
        dtype=torch.float32,
        pretrained_backbone=True,
    ):
        """
        ViT classifier used by Community Forensics.

        Parameters
        ----------
        pretrained_backbone:
            True  -> initialize the timm backbone with ImageNet/AugReg weights.
                     Useful for the original training workflow.
            False -> build architecture only. This is the recommended mode for
                     final frozen-checkpoint inference because the checkpoint
                     supplies all model weights and no network access is needed.
        """
        super().__init__()

        self.device = torch.device(device)
        self.dtype = dtype

        model_names = {
            ("small", 224, 32): "vit_small_patch32_224.augreg_in21k_ft_in1k",
            ("small", 224, 16): "vit_small_patch16_224.augreg_in21k_ft_in1k",
            ("small", 384, 32): "vit_small_patch32_384.augreg_in21k_ft_in1k",
            ("small", 384, 16): "vit_small_patch16_384.augreg_in21k_ft_in1k",
            ("tiny", 224, 16): "vit_tiny_patch16_224.augreg_in21k_ft_in1k",
            ("tiny", 384, 16): "vit_tiny_patch16_384.augreg_in21k_ft_in1k",
        }

        key = (model_size, input_size, patch_size)
        if key not in model_names:
            raise ValueError(
                "Unsupported ViT configuration: "
                f"model_size={model_size}, input_size={input_size}, "
                f"patch_size={patch_size}"
            )

        self.vit = timm.create_model(
            model_names[key],
            pretrained=pretrained_backbone,
        )

        if freeze_backbone:
            for param in self.vit.parameters():
                param.requires_grad = False

        in_features = self.vit.head.in_features
        self.vit.head = nn.Linear(
            in_features=in_features,
            out_features=1,
            bias=True,
        )

        # Construct safely on CPU by default, then move explicitly.
        self.to(device=self.device, dtype=self.dtype)

        for param in self.vit.head.parameters():
            assert param.requires_grad, "Model head should be trainable."

    def forward(self, x):
        return self.vit(x)
