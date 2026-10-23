import argparse
import uvicorn
from .server import create_app

parser = argparse.ArgumentParser(description="Run Observatory Planner on localhost")
parser.add_argument("--port", type=int, default=8140)
parser.add_argument("--database", default=None)
args = parser.parse_args()
uvicorn.run(create_app(args.database), host="127.0.0.1", port=args.port)
