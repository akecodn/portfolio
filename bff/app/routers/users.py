from fastapi import APIRouter, Depends, HTTPException, status
from psycopg2 import IntegrityError

from ..auth import require_access_management
from ..db import create_user as db_create_user
from ..db import get_users as db_get_users
from ..db import update_user_position_books as db_update_user_position_books
from ..db import update_user_permissions as db_update_user_permissions
from ..models import UserCreateIn, UserOut, UserPermissionsIn, UserPositionBooksIn

router = APIRouter()


@router.get("/users", response_model=list[UserOut])
def get_users(_: dict = Depends(require_access_management)):
    return db_get_users()


@router.post("/users", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreateIn, _: dict = Depends(require_access_management)):
    try:
        return db_create_user(payload.username, payload.password, payload.is_admin)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="User with this username already exists.") from exc


@router.put("/users/{user_id}/permissions", response_model=UserOut)
def set_user_permissions(user_id: int, payload: UserPermissionsIn, _: dict = Depends(require_access_management)):
    try:
        return db_update_user_permissions(
            user_id=user_id,
            can_view_positions=payload.can_view_positions,
            can_view_books=payload.can_view_books,
            can_manage_access=payload.can_manage_access,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc


@router.put("/users/{user_id}/position-books", response_model=UserOut)
def set_user_position_books(
    user_id: int, payload: UserPositionBooksIn, _: dict = Depends(require_access_management)
):
    try:
        return db_update_user_position_books(user_id=user_id, book_ids=payload.book_ids)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="User not found.") from exc
