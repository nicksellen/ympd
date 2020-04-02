FROM debian:10.2

WORKDIR /app/build
VOLUME /app

RUN apt-get update && apt-get install -y cmake libmpdclient-dev
RUN apt-get install -y libssl-dev 
