import time
import pyautogui
import pytesseract
from pytesseract import Output
import os
import json
import cv2
import numpy as np
from datetime import datetime
import re

MAX_SCROLLS = 50
SCROLL_LENGTH = 30
SCROLL_WAIT = 0.1

CONFIG_FILE = "config.json"
CACHE_FILE = "friends_index.json"

DEFAULT_CONFIG = {
    "friends_list_region": None,  # (left, top, width, height)
    "map_region": None,  # (left, top, width, height)
    "index_stale_time": 14400,  # 4 hours
    "ocr_language": "eng",
    "map_load_delay": 4.0,
    "screenshot_dir": "screenshots",
    "filename_format": "{name}_{timestamp}.png"
}

class Friend:
  def __init__(self, name:str, scrolls:int, y:int):
    self.name:str = name
    self.scrolls:int = scrolls
    self.y:int = y

    self.last_screenshot:str = None
    self.last_screenshot_at:float = None
  def to_dict(self):
    return {
      "name": self.name,
      "last_screenshot": self.last_screenshot,
      "last_screenshot_at": self.last_screenshot_at,
      "scrolls": self.scrolls,
      "y": self.y
    }
  @staticmethod
  def from_dict(data:dict):
    friend = Friend(data["name"], data["scrolls"], data["y"])
    friend.last_screenshot = data.get("last_screenshot", None)
    friend.last_screenshot_at = data.get("last_screenshot_at", None)
    return friend
  def __repr__(self): return f"Friend(name={self.name}, scrolls={self.scrolls}, y={self.y})"

class FindMy:
  def __init__(self):
    self.friends_index:dict[str, Friend] = {}
    self.selected_friend:str = None
    self.currently_selected_friend:str|None = None
    self.config = DEFAULT_CONFIG.copy()
    self.last_sync = None
    self.load_config()
  
  # Mouse controls
  def mouse_to_list(self):
    pyautogui.moveTo(self.config["friends_list_region"][0] + 10, self.config["friends_list_region"][1] + 10)
  def scroll_to_top(self):
    self.mouse_to_list()
    for _ in range(3):
        pyautogui.scroll(600)
        time.sleep(SCROLL_WAIT)

  def build_index(self):
    print("Building Friends index (OCR scan)...")
    
    # Save current friends data before clearing
    saved_friends_data = {}
    for friend_name, friend in self.friends_index.items():
      saved_friends_data[friend_name] = {
        'last_screenshot': friend.last_screenshot,
        'last_screenshot_at': friend.last_screenshot_at,
        'name': friend.name
      }
    print(f"Saved metadata for {len(saved_friends_data)} existing friends")
    
    self.scroll_to_top()
    pyautogui.click(self.config["map_region"][0] + 50, self.config["map_region"][1] + 50)  # Click map to defocus list

    self.friends_index.clear()
    seen_names = set()
    scroll_count = 0 # We keep track so we can replay the scrolls later
    scrolls_without_new_names = 0 # To detect end of list

    for attempt in range(MAX_SCROLLS):
      img = pyautogui.screenshot(region=self.config["friends_list_region"])
      filtered = self.filter_text_color(img)
      data = pytesseract.image_to_data(filtered, output_type=Output.DICT)

      current_line = []
      last_top = None
      new_names_this_scroll = 0

      def process_current_line():
        nonlocal last_top, current_line, new_names_this_scroll
        if not current_line: return
        if not last_top: return
        raw_name = " ".join(current_line)
        name = self.clean_name(raw_name)
        if not name or name in seen_names: return
        screen_y = self.config["friends_list_region"][1] + last_top
        self.friends_index[name] = Friend(name, scroll_count, screen_y)
        seen_names.add(name)
        new_names_this_scroll += 1
        print(f"Indexed: {name} scrolls={scroll_count} y={screen_y}")

      for i, word in enumerate(data["text"]):
        word = word.strip()
        if not word: continue
        top = data["top"][i]
        # Check if same line (within 12 pixels)
        if last_top is None or abs(top - last_top) < 12:
          current_line.append(word)
        else:
          # New line detected, process accumulated line
          process_current_line()
          current_line = [word]
        last_top = top

      # Process last line if any
      process_current_line()
    
      # Early termination logic
      if new_names_this_scroll == 0:
        scrolls_without_new_names += 1
        print(f"No new names found (attempt {scrolls_without_new_names}/2)")
        if scrolls_without_new_names >= 2:
          print("No new names after 2 scrolls - stopping early")
          break
      else:
        scrolls_without_new_names = 0  # Reset counter
      
      self.mouse_to_list()
      pyautogui.scroll(-SCROLL_LENGTH)
      scroll_count += 1
      time.sleep(SCROLL_WAIT)
    
    # Restore saved metadata - for exact name matches only unfortunately
    n = 0
    for friend_name, friend in self.friends_index.items():
      if friend_name in saved_friends_data:
        n += 1
        friend.last_screenshot = saved_friends_data[friend_name]['last_screenshot']
        friend.last_screenshot_at = saved_friends_data[friend_name]['last_screenshot_at']
    print(f"Restored metadata for {n} friends from previous index")

    self.save_index()
    print(f"Indexed {len(self.friends_index)} friends at {self.last_sync}")

  def load_index(self) -> bool:
    if os.path.exists(CACHE_FILE):
      with open(CACHE_FILE, "r") as f:
        cache_data:dict = json.load(f)
        if(not cache_data or "friends_index" not in cache_data):
          print("No valid cache data found.")
          return False
        self.friends_index = { name: Friend.from_dict(friend_data) for name, friend_data in cache_data.get("friends_index", {}).items() }
        self.last_sync = cache_data.get("last_sync", None)
        print(f"Loaded index with {len(self.friends_index)} friends from cache.")
        return True
    else:
      print("No cache file found.")
      return False

  def click_friend(self, name:str, force_click=False):
    """Click on friend, with option to skip if already selected"""
    key = None
    for ind_name in self.friends_index:
      if name.lower() in ind_name.lower():
        key = ind_name
        break

    if not key: return False # Not found

    # Check if this friend is already selected
    if not force_click and self.currently_selected_friend == key:
      print(f"Friend {key} already selected, skipping click")
      return True

    self.scroll_to_top()

    for _ in range(self.friends_index[key].scrolls):
      self.mouse_to_list()
      pyautogui.scroll(-SCROLL_LENGTH)
      time.sleep(SCROLL_WAIT)

    # Perform the click in the middle of the name area
    click_x = self.config["friends_list_region"][0] + (self.config["friends_list_region"][2] // 2)
    click_y = self.friends_index[key].y
    pyautogui.click(click_x, click_y)
    print(f"Clicked {name} (scrolls={self.friends_index[key].scrolls}, y={click_y})")
    time.sleep(self.config["map_load_delay"])

    # Update currently selected friend
    self.currently_selected_friend = key
    return True

  def screenshot_map(self, custom_filename:str=None):
      """Take screenshot of map area, of currently selected friend"""
      if(not self.currently_selected_friend): friend_name = "NO_SELECTION"
      else: friend_name = self.currently_selected_friend
      
      timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
      filename = self.config["filename_format"]
      if(custom_filename): filename = custom_filename
      filename = filename.format(name=friend_name, timestamp=timestamp)
      if(filename[:-4].lower() != ".png"): filename += ".png" # Ensure .png extension
      path = os.path.join(self.config["screenshot_dir"], filename)
      pyautogui.screenshot(region=self.config["map_region"]).save(path)
      print(f"Saved screenshot: {filename}")

      current_friend = self.get_selected_friend()
      if(current_friend):
        current_friend.last_screenshot = filename
        current_friend.last_screenshot_at = time.time()
        self.save_index()
      return filename

  def save_index(self):
    cache_data = {
      "friends_index": { name: friend.to_dict() for name, friend in self.friends_index.items() },
      "last_sync": self.last_sync
    }
    with open(CACHE_FILE, "w") as f: json.dump(cache_data, f, indent=2)

  def load_or_build_index(self):
    res = self.load_index()
    if not res:
      print("Could not load index, building new one...")
      self.build_index()
      return
    if not self.last_sync:
      print("No last sync timestamp, rebuilding index...")
      self.build_index()
      return
    # Parse ISO format timestamp
    last_sync_time = datetime.fromisoformat(self.last_sync).timestamp()
    current_time = time.time()
    if (current_time - last_sync_time) > self.config["index_stale_time"]:
      print("Index is stale, rebuilding...")
      self.build_index()
      return
    print("Index is fresh, no need to automaticly rebuild.")
  
  def load_config(self):
    if os.path.exists(CONFIG_FILE):
      with open(CONFIG_FILE, "r") as f:
        self.config = json.load(f)
    else:
      print("No config file found, using default configuration.")
      print("Setup the bot to create a config file.")

  def find_friend(self, name):
    """Find friend by partial name match"""
    if not name: return None   
    name_lower = name.lower()
    # First try exact match
    if name_lower in self.friends_index: return name_lower
        
    # Then try partial match
    for indexed_name in self.friends_index:
      if name_lower in indexed_name.lower() or indexed_name.lower() in name_lower:
        return indexed_name
    return None
  
  def get_all_friends(self) -> list[Friend]:
    """Get list of all indexed friends"""
    return list(self.friends_index.values())

  def clear_selection(self):
    """Clear currently selected friend tracking"""
    self.currently_selected_friend = None
    print("Cleared friend selection tracking")

  def get_selected_friend(self) -> Friend | None:
    """Get currently selected friend"""
    return self.friends_index.get(self.currently_selected_friend, None)
    
  @staticmethod
  def clean_name(name):
    """Clean up name by removing unwanted characters"""
    # Remove anything in parentheses and non-alphanumeric except spaces
    name = re.sub(r'\([^)]*\)', '', name)  # Remove (content)
    name = re.sub(r'[^a-zA-Z0-9\s]', '', name)  # Keep only letters, numbers, spaces
    return ' '.join(name.split()).lower()  # Normalize whitespace and lowercase

  @staticmethod
  def clean_ocr_text(text):
      """Clean OCR extracted text"""
      return ''.join(filter(str.isalnum, text)).lower()

  @staticmethod # Make text extraction easy
  def filter_text_color(pil_img):
    gray = cv2.cvtColor(np.array(pil_img), cv2.COLOR_RGB2GRAY)
    _, thresh = cv2.threshold(gray, 65, 255, cv2.THRESH_BINARY_INV)
    kernel = np.ones((2,2), np.uint8)
    thresh = cv2.dilate(thresh, kernel, iterations=1)
    return thresh
  









# ======================================
# SETUP SCRIPT
if __name__ == "__main__":
  ask = input("1. Setup FindMy Config\n2.Test Indexing\n3. Test Friend Selection\nChoose an option (1, 2 or 3): ")
  if ask.lower() == "2":
    bot = FindMy()
    print("Building index for testing... starting in 3 seconds, switch to Find My app window.")
    time.sleep(3)
    bot.build_index()
    print("Indexed Friends:")
    for friend in bot.get_all_friends():
      print(f"- {friend}")
    exit(0)
  elif ask.lower() == "3":
    friend_name = input("Enter friend name to select: ")
    bot = FindMy()
    print("Starting in 3 seconds, switch to Find My app window.")
    time.sleep(3)
    bot.load_or_build_index()
    found_name = bot.find_friend(friend_name)
    if not found_name:
      print(f"Could not find '{friend_name}'")
      exit(1)
    if bot.click_friend(found_name): print(f"Successfully selected {found_name}")
    else: print(f"Could not select {found_name}")
    file = bot.screenshot_map()
    print(f"Screenshot saved to {file}")
    exit(0)
  
  if(ask.lower() != "1"): exit(1)


  # Setup config stuff
  hours_stale = input("Enter how many hours before the friends list is refreshed (default 4): ")
  try: hours_stale = int(hours_stale)
  except: hours_stale = 4

  map_delay = input("Enter how many seconds to wait for the map to load (default 4.0): ")
  try: map_delay = float(map_delay)
  except: map_delay = 4.0

  screenshot_dir = input("Enter directory to save screenshots (default 'screenshots'): ")
  if screenshot_dir.strip() == "": screenshot_dir = "screenshots"
  filename_format = input("Enter filename format (use {name} and {timestamp}, default '{name}_{timestamp}.png'): ")
  if filename_format.strip() == "": filename_format = "{name}_{timestamp}.png"

  # Setup bounds by having user click corners of regions, we detect mouse down and log positions
  print("\nYou will now layout the regions needed to proccess the Find My app.")
  print("First, we will set the Friends List region, this is where the list of friends appears.")
  print("We only want to capture the area containing the names, not the profile pictures or other UI elements.")
  print("After that, we will set the Map region, this is what is displayed when a friend is selected.")
  print("\nTo set each region, you will click in the top-left corner, then the bottom-right corner.")
  print("You will have 3 seconds to prepare before we start capturing clicks, so switch to the Find My app window when you start")
  print("You will do the list and map region one after the other.\n")
  input("Press Enter to begin...")
  time.sleep(3)
  print("Click the top-left corner of the friends list region.")

  import pynput.mouse as mouse
  click_detected = False
  def on_click(x, y, button, pressed):
    global click_detected
    if pressed:
      click_detected = True
      return False  # Stop listener
  
  def get_next_click_position():
    global click_detected
    click_detected = False
    listener = mouse.Listener(on_click=on_click)
    listener.start()
    while not click_detected: time.sleep(0.01)
    return pyautogui.position()
  
  tl_x, tl_y = get_next_click_position()
  print(f"Top-left corner recorded at ({tl_x}, {tl_y}), waiting for bottom-right corner...")
  br_x, br_y = get_next_click_position()
  print(f"Bottom-right corner recorded at ({br_x}, {br_y}).")
  list_region = (tl_x, tl_y, br_x - tl_x, br_y - tl_y)
  print("Friends list region set.\n")

  print("\nWaiting for top-left corner of the map region...")
  tl_x, tl_y = get_next_click_position()
  print(f"Top-left corner recorded at ({tl_x}, {tl_y}), waiting for bottom-right corner...")
  br_x, br_y = get_next_click_position()
  print(f"Bottom-right corner recorded at ({br_x}, {br_y}).")
  map_region = (tl_x, tl_y, br_x - tl_x, br_y - tl_y)
  print("Map region set.\n")

  # Save previews of regions
  print("Capturing preview screenshots of the selected regions...")
  list_img = pyautogui.screenshot(region=list_region)
  map_img = pyautogui.screenshot(region=map_region)
  os.makedirs("setup_previews", exist_ok=True)
  list_img.save(os.path.join("setup_previews", "friends_list_region.png"))
  map_img.save(os.path.join("setup_previews", "map_region.png"))
  print("Previews saved to 'setup_previews' folder. Please verify they are correct.\n")

  # Save config
  config = {
    "friends_list_region": list_region,
    "map_region": map_region,
    "index_stale_time": hours_stale * 3600,
    "ocr_language": "eng",
    "map_load_delay": map_delay,
    "screenshot_dir": screenshot_dir,
    "filename_format": filename_format
  }
  with open("config.json", "w") as f: json.dump(config, f, indent=4)
  print("\nConfiguration saved to config.json. Setup complete.")
