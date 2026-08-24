from fastapi import FastAPI

from .services import load_user

app = FastAPI()


@app.get("/users/{user_id}")
def get_user(user_id: str):
    return load_user(user_id)
