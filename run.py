# run.py
import uvicorn
import webbrowser
import socket
import sys
from threading import Timer
from backend.main import app 

# FIX: If running under --noconsole, standard streams are None.
# We override them to dummy objects to prevent Uvicorn/logging from crashing.
if sys.stdout is None:
    class DummyStream:
        def write(self, x): pass
        def flush(self): pass
        def isatty(self): return False
    sys.stdout = DummyStream()
    sys.stderr = DummyStream()

def find_available_port(start_port=8000):
    """Checks ports starting from start_port until it finds an open one."""
    port = start_port
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                return port  # Port is free
            port += 1  # Try next port

def open_browser(port):
    webbrowser.open_new(f"http://127.0.0.1:{port}")

if __name__ == "__main__":
    # Dynamically find an open port
    assigned_port = find_available_port(start_port=8000)
    
    # Wait 1.5 seconds, then open the browser to the correct dynamic port
    Timer(1.5, open_browser, args=[assigned_port]).start()
    
    # Run uvicorn without its default terminal-logging configurations
    # All keyword arguments verified lowercase to match Uvicorn's expected API
    uvicorn.run(
        app, 
        host="127.0.0.1", 
        port=assigned_port, 
        log_config=None  # Disables the default Uvicorn logger setup that breaks noconsole
    )