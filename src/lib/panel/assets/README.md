# manga-panel-detector-yolo26n.onnx

Manga panel detector used by `src/lib/panel/`.

- Source model: https://huggingface.co/leoxs22/manga-panel-detector-yolo26n (YOLO26-nano fine-tuned from Ultralytics YOLO26n)
- License: AGPL-3.0 (inherited from the Ultralytics base weights)
- Training data: Manga109-s. Classes: 0 = panel (labelled `frame` in the export), 1 = text.
- This file is the fp32 weights exported to ONNX (imgsz 640, opset 17, output `(1, 6, 8400)`, no NMS), then statically quantized to int8 (QDQ, per-channel weights, min-max calibration on 42 manga pages). The detection head (`/model.23/*`) is kept in fp32.
