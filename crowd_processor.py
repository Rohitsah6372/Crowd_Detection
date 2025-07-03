import cv2
import numpy as np
import collections
import threading
import time
from datetime import datetime  # For timestamping alerts
import torch
import sys
sys.path.append('./YOLO-CROWD')
from models.experimental import attempt_load


class CrowdProcessor:
    """
    Video processing and crowd detection using YOLO-CROWD (Yolov5-based).
    Replaces HOG + SVM with a deep learning model for improved accuracy.
    """

    def __init__(
        self,
        model_path: str = "models/yolo-crowd.pt",
        device: str = "cpu",
        conf_threshold: float = 0.1,
    ):
        # Load YOLO-CROWD model
        self.device = device
        self.model = attempt_load(model_path, map_location=self.device)
        self.model.to(self.device).eval()
        self.model.conf = conf_threshold

        self.video_source = None
        self.roi_coords = None  # (x, y, w, h)
        self.density_threshold_high = 0.05
        self.density_threshold_critical = 0.10

        # History for prediction
        self.density_history = collections.deque(maxlen=30)
        self.alert_history = collections.deque(maxlen=50)

        # Latest stats
        self.latest_people_count = 0
        self.latest_current_density = 0.0
        self.latest_predicted_density = None
        self.latest_alert_message = "Normal"
        self.latest_estimated_people = 0
        self.current_frame_width = 0
        self.current_frame_height = 0

        self.real_world_roi_area_m2 = 10000
        self.area_per_person_m2 = 0.25
        self.detection_correction_factor = 10
        self.super_critical_threshold = 1_000_000
        # Add head count history for 1-hour intervals
        self.head_count_history = []

    def set_video_source(self, source_type, source_path):
        if self.video_source:
            self.video_source.release()
        if source_type == "webcam":
            self.video_source = cv2.VideoCapture(int(source_path))
        else:
            self.video_source = cv2.VideoCapture(source_path)
        if not self.video_source.isOpened():
            print(f"Error opening video: {source_path}")
            return False
        self.current_frame_width = int(self.video_source.get(cv2.CAP_PROP_FRAME_WIDTH))
        self.current_frame_height = int(
            self.video_source.get(cv2.CAP_PROP_FRAME_HEIGHT)
        )
        print(f"Opened ({self.current_frame_width}x{self.current_frame_height})")
        return True

    def get_frame(self):
        if self.video_source and self.video_source.isOpened():
            return self.video_source.read()
        return False, None

    def set_roi(self, x_pct, y_pct, w_pct, h_pct):
        x = int(x_pct * self.current_frame_width / 100)
        y = int(y_pct * self.current_frame_height / 100)
        w = int(w_pct * self.current_frame_width / 100)
        h = int(h_pct * self.current_frame_height / 100)
        self.roi_coords = (x, y, w, h)
        print(f"ROI pixels: {self.roi_coords}")

    def process_frame(self, frame):
        disp = frame.copy()
        if not self.roi_coords:
            cv2.putText(
                disp,
                "Select ROI first",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2,
            )
            return disp

        x, y, w, h = self.roi_coords
        if w == 0 or h == 0:
            cv2.putText(
                disp,
                "Invalid ROI selected. Please select a valid ROI.",
                (10, 60),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 0, 255),
                2,
            )
            return disp

        roi = frame[y : y + h, x : x + w]
        rgb_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2RGB)

        # Ensure ROI dimensions are multiples of 32 for YOLO compatibility
        def make_divisible(x, divisor=32):
            return int(np.floor(x / divisor) * divisor)
        h, w, _ = rgb_roi.shape
        new_h = make_divisible(h)
        new_w = make_divisible(w)
        if new_h != h or new_w != w:
            rgb_roi = rgb_roi[:new_h, :new_w, :]

        # Ensure input is a torch tensor with correct shape
        if isinstance(rgb_roi, np.ndarray):
            if rgb_roi.ndim == 3:
                rgb_roi = torch.from_numpy(rgb_roi).permute(2, 0, 1).unsqueeze(0).float()  # (1, 3, H, W)
            else:
                rgb_roi = torch.from_numpy(rgb_roi).float()
        print(f"[DEBUG] rgb_roi shape: {rgb_roi.shape}, dtype: {rgb_roi.dtype}")

        # Inference
        results = self.model(rgb_roi)
        detections = results[0]  # First element is the detection tensor
        if isinstance(detections, torch.Tensor):
            detections = detections.squeeze(0).cpu().numpy()  # Remove batch dim if present
            # Filter by confidence threshold (e.g., >0.1)
            conf_threshold = self.model.conf if hasattr(self.model, 'conf') else 0.1
            detections = detections[detections[:, 4] > conf_threshold]
            print(f"[DEBUG] Raw detections array: {detections}")
            people_count = len(detections)
        else:
            detections = np.array([])
            people_count = 0

        # Density
        roi_pixels = w * h
        # Calculate real-world density if real_world_roi_area_m2 is set and positive
        real_world_density = None
        if self.real_world_roi_area_m2 and self.real_world_roi_area_m2 > 0:
            real_world_density = people_count / self.real_world_roi_area_m2
            density = real_world_density
        else:
            density = people_count / roi_pixels if roi_pixels > 0 else 0
        self.density_history.append(density)
        pred_density = None
        if len(self.density_history) >= 5:
            pred_density = sum(list(self.density_history)[-5:]) / 5
        # Estimate
        est_people = int(
            (self.real_world_roi_area_m2 / self.area_per_person_m2)
            * self.detection_correction_factor
        )

        # Alert logic based on density thresholds
        if density < 1:
            alert = "Low"
            color = (0, 255, 0)
        elif density < 2:
            alert = "Medium"
            color = (0, 165, 255)
        elif density < 4:
            alert = "High"
            color = (0, 0, 255)
        else:
            alert = "Extreme"
            color = (128, 0, 128)
        if est_people >= self.super_critical_threshold:
            alert = "SUPER CRITICAL"
            color = (128, 0, 128)
            self.alert_history.append(
                {
                    "time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "density": density,
                    "pred": pred_density,
                    "estimated": est_people,
                    "alert": alert,
                }
            )

        # Draw ROI and boxes
        cv2.rectangle(disp, (x, y), (x + w, y + h), color, 2)
        for det in detections:
            x1, y1, x2, y2, conf, cls = det
            # Draw a red dot at the center of each detected head
            center_x = x + int((x1 + x2) / 2)
            center_y = y + int((y1 + y2) / 2)
            cv2.circle(
                disp,
                (center_x, center_y),
                5,  # radius of the dot
                (0, 0, 255),  # red color in BGR
                -1  # filled circle
            )
        cv2.putText(
            disp,
            f"Count:{people_count}",
            (x + 5, y + 20),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )
        cv2.putText(
            disp,
            f"Density:{density:.4f} people/m^2" if real_world_density is not None else f"Density:{density:.4f}",
            (x + 5, y + 45),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )
        pred_text = f"Pred:{pred_density:.4f}" if pred_density else "Pred:N/A"
        cv2.putText(
            disp, pred_text, (x + 5, y + 70), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2
        )
        cv2.putText(
            disp,
            f"Alert:{alert}",
            (x + 5, y + 95),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.6,
            color,
            2,
        )
        cv2.putText(
            disp,
            f"Est:{est_people}",
            (x, y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (128, 0, 128) if alert == "SUPER CRITICAL" else (0, 255, 255),
            2,
        )

        # Update stats
        self.latest_people_count = people_count
        self.latest_current_density = density
        self.latest_predicted_density = pred_density
        self.latest_alert_message = alert
        self.latest_estimated_people = est_people

        # Update head count history at 5-second intervals
        now = datetime.now()
        # Round down to the nearest 5 seconds
        rounded_seconds = now.second - (now.second % 5)
        interval_timestamp = now.replace(second=rounded_seconds, microsecond=0)
        if not self.head_count_history or self.head_count_history[0][0] != interval_timestamp:
            self.head_count_history.insert(0, (interval_timestamp, people_count))
        else:
            # Update the latest entry for this interval
            self.head_count_history[0] = (interval_timestamp, people_count)

        print(f"[DEBUG] People detected: {people_count}, ROI: {self.roi_coords}, Density: {density}")

        return disp

    def get_latest_stats(self):
        return {
            "people_count": self.latest_people_count,
            "density": self.latest_current_density,
            "pred_density": self.latest_predicted_density,
            "alert": self.latest_alert_message,
            "est_people": self.latest_estimated_people,
        }

    def get_alert_history(self):
        return list(self.alert_history)

    def get_head_count_history(self):
        # Return history as list of dicts for easy JSON serialization
        return [
            {"time": ts.strftime("%Y-%m-%d %H:%M:%S"), "people_count": count}
            for ts, count in self.head_count_history
        ]

    def stop(self):
        if self.video_source:
            self.video_source.release()
        self.roi_coords = None
        self.density_history.clear()
        self.alert_history.clear()
        self.head_count_history.clear()
        print("Stopped and reset.")
