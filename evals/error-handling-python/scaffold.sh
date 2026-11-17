#!/bin/sh
# A small Python package in git. The last commit adds a payment module that swallows an error with a bare
# `except: pass` and replaces another error's cause with its message.
set -eu
d=${1:-$PWD}
cd "$d"
git init -q -b main
git config user.name eval
git config user.email eval@example.invalid
mkdir -p src/shop tests
cat > pyproject.toml <<'TOML'
[project]
name = "sample-shop"
version = "0.1.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
TOML
: > src/shop/__init__.py
cat > src/shop/cart.py <<'PY'
def cart_total(lines: list[dict]) -> int:
    """Sum line totals of a cart in cents."""
    return sum(line["price_cents"] * line["quantity"] for line in lines)
PY
cat > tests/test_cart.py <<'PY'
from shop.cart import cart_total


def test_sums_line_totals():
    assert cart_total([{"price_cents": 250, "quantity": 2}]) == 500
PY
git add -A
git commit -q -m "feat: cart total"
cat > src/shop/payments.py <<'PY'
import json
import urllib.request


class PaymentError(Exception):
    pass


def record_attempt(order_id: str, log_path: str) -> None:
    try:
        with open(log_path, "a") as log:
            log.write(order_id + "\n")
    except:
        pass


def charge(order_id: str, amount_cents: int, url: str) -> dict:
    body = json.dumps({"order": order_id, "amount": amount_cents}).encode()
    try:
        with urllib.request.urlopen(url, data=body, timeout=5) as res:
            return json.load(res)
    except OSError as err:
        raise PaymentError(str(err))
PY
git add -A
git commit -q -m "feat: charge an order"
