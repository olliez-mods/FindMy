from flask import Flask, request, send_from_directory, send_file, jsonify
import time
import os

# For tasks
import threading
import uuid
from datetime import datetime
from enum import Enum

from findmy import FindMy

app = Flask(__name__)
findmy = FindMy()

PORT = 5050
PUBLIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'public')
os.makedirs(PUBLIC_DIR, exist_ok=True)

class TaskStatus(Enum):
  PENDING = 'pending'
  IN_PROGRESS = 'in_progress'
  COMPLETED = 'completed'
  FAILED = 'failed'
class Task:
  tasks:dict[str, 'Task'] = {}
  def __init__(self, task_function, *args, **kwargs):
    self.task_id = str(uuid.uuid4()) # Generate unique task ID
    self.task_function = task_function
    self.args = args
    self.kwargs = kwargs
    self.result = None

    self.timeout:float = None
    self.thread:threading.Thread = None

    self.status:TaskStatus = TaskStatus.PENDING
    self.error:str = None
    self.created_at:float = time.time()
    self.started_at:float = None
    self.completed_at:float = None
  def _run_wrapper(self):
    self.started_at = time.time()
    self.status = TaskStatus.IN_PROGRESS
    try:
      self.result = self.task_function(*self.args, **self.kwargs)
      self.status = TaskStatus.COMPLETED
    except Exception as e:
      self.status = TaskStatus.FAILED
      self.error = str(e)
    self.completed_at = time.time()
  def run(self): # Return result directly
    self._run_wrapper()
    return self.result
  def run_async(self, timeout:float=None) -> str: # Return task ID
    self.timeout = timeout
    self.thread = threading.Thread(target=self._run_wrapper, daemon=True)
    self.thread.start()
    return self.task_id
  def get_request_return(self, wait_for_result:bool = True, step_interval:float = 0.2) -> tuple[dict, int]:
    while(wait_for_result and self.status == TaskStatus.IN_PROGRESS):
      time.sleep(step_interval)
      if self.timeout and (time.time() - self.started_at) > self.timeout:
        self.status = TaskStatus.FAILED
        self.error = "Task timed out"
        self.thread = None
        print(f"Task {self.task_id} timed out, MAY still be running in background")
        break
    if(self.status == TaskStatus.PENDING): return {"status": self.status.value, "message": "Task is pending start"}, 202
    if(self.status == TaskStatus.IN_PROGRESS): return {"status": self.status.value, "message": "Task is in progress"}, 202
    if(self.status == TaskStatus.COMPLETED): return {"status": self.status.value, "message": "Task completed", "result": self.result}, 200
    if(self.status == TaskStatus.FAILED): return {"status": self.status.value, "message": "Task failed", "error": self.error}, 500
  @staticmethod
  def get_task_result(task_id: str|None, wait_for_result:bool = True, step_interval:float = 0.2) -> tuple[dict, int]:
    if(not task_id): return {"error": "task_id parameter is required"}, 400
    task = Task.get_task(task_id)
    if not task: return {"error": "Task not found"}, 404
    return task.get_request_return(wait_for_result, step_interval)
  @staticmethod
  def create_task(task_function, *args, **kwargs) -> 'Task':
    task = Task(task_function, *args, **kwargs)
    Task.tasks[task.task_id] = task
    print(f"Created task {task.task_id} - Total tasks: {len(Task.tasks)}")  # Debug
    return task
  @staticmethod
  def get_task(task_id: str) -> 'Task | None':
    print(f"Looking for task {task_id} - Available tasks: {list(Task.tasks.keys())}")  # Debug
    return Task.tasks.get(task_id, None)
  @staticmethod
  def cleanup_old_tasks(max_age_seconds: int = 43200): # Older than 12 hours
    current_time = time.time()
    to_delete = [task_id for task_id, task in Task.tasks.items() if (current_time - task.created_at) > max_age_seconds]
    for task_id in to_delete: del Task.tasks[task_id]

def get_arg_or_param(name: str, default=None, type=None):
  """Get value from request headers, URL parameters, or JSON body"""
  # Try headers first
  value = request.headers.get(name)
  # Then try URL parameters
  if value is None:
    value = request.args.get(name)
  # Then try JSON body
  if value is None and request.is_json:
    json_data = request.get_json(silent=True)
    if json_data and isinstance(json_data, dict):
      value = json_data.get(name)
  # Apply default if still None
  if value is None:
    value = default
  # Apply type conversion
  if type and value is not None:
    try:
      value = type(value)
    except (ValueError, TypeError):
      value = default  # Handle conversion errors, use default
  return value

@app.route('/')
def index():
  return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/friends/<path:friend_name>')
def friend_page(friend_name):
  return send_from_directory(PUBLIC_DIR, 'index.html')

@app.route('/<path:path>')
def serve_static(path):
  try: return send_from_directory(PUBLIC_DIR, path)
  except: return "Not Found", 404

@app.route('/api/friends_list', methods=['GET','POST'])
def api_friends_list():
  friends = findmy.get_all_friends()
  result = {
    "last_sync": findmy.last_sync,
    "friends": [],
    "selected_friend": findmy.currently_selected_friend
  }
  for friend in friends:
    result["friends"].append({
      "name": friend.name,
      "last_screenshot": friend.last_screenshot if friend.last_screenshot else None,
      "last_screenshot_time": friend.last_screenshot_at if friend.last_screenshot_at else None
    })
  return jsonify(result)

@app.route('/api/task_wait', methods=['GET','POST'])
def api_sync_wait():
  task_id = get_arg_or_param("task_id", type=str)
  return Task.get_task_result(task_id)

@app.route('/api/tasks', methods=['GET'])
def api_list_tasks():
  """List all tasks (useful for debugging)"""
  task_list = []
  for task in Task.tasks.values():
    task_list.append({
      "id": task.task_id,
      "status": task.status.value,
      "created_at": task.created_at,
      "started_at": task.started_at,
      "completed_at": task.completed_at,
      "error": task.error
    })
  return jsonify({"tasks": task_list})

@app.route('/api/sync', methods=['GET','POST'])
def api_sync():
  task = Task.create_task(findmy.build_index)
  task_id = task.run_async(30) # 30 second timeout
  return jsonify({"message": "Index sync started", "task_id": task_id})

@app.route('/api/select_friend', methods=['GET','POST'])
def api_select_friend():
  name = get_arg_or_param("name", type=str)
  if(not name): return jsonify({"error": "name parameter is required"}), 400
  friend = findmy.find_friend(name)
  if(not friend): return jsonify({"error": f"Friend '{name}' not found"}), 404

  task = Task.create_task(findmy.click_friend, name, True)
  task_id = task.run_async(30) # 30 second timeout
  return jsonify({"message": f"Selecting friend '{name}'", "task_id": task_id})

@app.route('/api/take_screenshot', methods=['GET','POST'])
def api_take_screenshot():
  task = Task.create_task(findmy.screenshot_map)
  task_id = task.run_async(5) # 5 second timeout
  return jsonify({"message": "Taking screenshot", "task_id": task_id})

@app.route('/api/get_screenshot', methods=['GET','POST'])
def api_get_screenshot():
  filename = get_arg_or_param("filename", type=str)
  if(not filename): return jsonify({"error": "filename parameter is required"}), 400
  screenshot_path = os.path.join(findmy.config["screenshot_dir"], filename)
  if(not os.path.exists(screenshot_path)): return jsonify({"error": f"Screenshot '{filename}' not found"}), 404
  return send_file(screenshot_path, mimetype='image/png')

@app.route('/api/list_screenshots', methods=['GET','POST'])
def api_list_screenshots():
  try:
    screenshot_dir = findmy.config["screenshot_dir"]
    screenshots = []
    for filename in os.listdir(screenshot_dir):
      file_path = os.path.join(screenshot_dir, filename)
      if os.path.isfile(file_path): screenshots.append((filename, os.path.getmtime(file_path)))
    return jsonify({"screenshots": screenshots})
  except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/delete_screenshot', methods=['GET','POST'])
def api_delete_screenshot():
  try:
    filename = get_arg_or_param("filename", type=str)
    if(not filename): return jsonify({"error": "filename parameter is required"}), 400
    screenshot_path = os.path.join(findmy.config["screenshot_dir"], filename)
    if(not os.path.exists(screenshot_path)): return jsonify({"error": f"Screenshot '{filename}' not found"}), 404
    os.remove(screenshot_path)
    return jsonify({"message": f"Deleted screenshot '{filename}'"})
  except Exception as e: return jsonify({"error": str(e)}), 500

@app.route('/api/delete_all_screenshots', methods=['GET','POST'])
def api_delete_all_screenshots():
  try:
    screenshot_dir = findmy.config["screenshot_dir"]
    deleted_files = []
    for filename in os.listdir(screenshot_dir):
      file_path = os.path.join(screenshot_dir, filename)
      if os.path.isfile(file_path):
        os.remove(file_path)
        deleted_files.append(filename)
    return jsonify({"message": f"Deleted {len(deleted_files)} screenshots", "deleted_files": deleted_files})
  except Exception as e: return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
  app.run(host='0.0.0.0', port=PORT)
  print(f"Web host running on port {PORT}")