-- Normalize legacy url_swap_tasks intervals (240/480 min) to current canonical options.

UPDATE url_swap_tasks
SET swap_interval_minutes = 360
WHERE swap_interval_minutes = 240;

UPDATE url_swap_tasks
SET swap_interval_minutes = 720
WHERE swap_interval_minutes = 480;
